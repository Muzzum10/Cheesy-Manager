"use strict";

const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const { Pool, types } = require("pg");

const BIGINT_OID = 20;
const NUMERIC_OID = 1700;
const INTEGER_OID = 23;
const SMALLINT_OID = 21;
const txStorage = new AsyncLocalStorage();

types.setTypeParser(BIGINT_OID, (value) => Number(value));
types.setTypeParser(NUMERIC_OID, (value) => Number(value));
types.setTypeParser(INTEGER_OID, (value) => Number(value));
types.setTypeParser(SMALLINT_OID, (value) => Number(value));

const IDENTITY_COLUMNS = new Map([
  ["admin_audit_logs", "id"],
  ["generated_fixtures", "id"],
  ["hc_analysis_messages", "id"],
  ["hc_analysis_sessions", "id"],
  ["hc_auto_matches", "id"],
  ["hc_auto_message_versions", "id"],
  ["hc_cricket_saved_embeds", "id"],
  ["hc_matchup_match_log", "id"],
  ["ipl_prediction_matches", "id"],
  ["match_reservations", "id"],
  ["potd_polls", "id"],
  ["pt_matches", "id"],
  ["scheduled_messages", "id"],
  ["support_bug_reports", "id"],
  ["support_tickets", "id"],
  ["support_warnings", "id"],
  ["team_join_requests", "id"],
  ["teams", "team_id"]
]);

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function getActiveTransaction() {
  const store = txStorage.getStore();
  return store && store.client ? store : null;
}

function getClient(pool) {
  const tx = getActiveTransaction();
  return tx ? tx.client : pool;
}

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

function convertDoubleQuotedString(sql, startIndex) {
  let endIndex = startIndex + 1;
  let rawValue = "";

  while (endIndex < sql.length) {
    const char = sql[endIndex];
    if (char === "\"") {
      if (sql[endIndex + 1] === "\"") {
        rawValue += "\"";
        endIndex += 2;
        continue;
      }
      endIndex += 1;
      break;
    }
    rawValue += char;
    endIndex += 1;
  }

  return {
    text: `'${rawValue.replace(/'/g, "''")}'`,
    nextIndex: endIndex
  };
}

function replaceSqliteSyntax(sql) {
  let result = "";
  let paramIndex = 0;

  for (let index = 0; index < sql.length;) {
    const char = sql[index];

    if (char === "'") {
      result += char;
      index += 1;
      while (index < sql.length) {
        const innerChar = sql[index];
        result += innerChar;
        index += 1;
        if (innerChar === "'" && sql[index] !== "'") {
          break;
        }
        if (innerChar === "'" && sql[index] === "'") {
          result += sql[index];
          index += 1;
        }
      }
      continue;
    }

    if (char === "\"") {
      const converted = convertDoubleQuotedString(sql, index);
      result += converted.text;
      index = converted.nextIndex;
      continue;
    }

    if (char === "?") {
      paramIndex += 1;
      result += `$${paramIndex}`;
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  return result
    .replace(/\bBEGIN\s+IMMEDIATE\s+TRANSACTION\b/gi, "BEGIN")
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN")
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.]*)\s+COLLATE\s+NOCASE\b/gi, "LOWER($1)")
    .replace(/CAST\(strftime\('%s','now'\)\s+AS\s+INTEGER\)/gi, "EXTRACT(EPOCH FROM NOW())::bigint");
}

function transformSql(sql) {
  const raw = String(sql || "").trim();
  if (!raw) {
    return { text: raw };
  }

  if (/^PRAGMA\s+wal_checkpoint/i.test(raw)) {
    return { text: "select 'ok'::text as wal_checkpoint" };
  }

  if (/^PRAGMA\s+page_size/i.test(raw)) {
    return { text: "select current_setting('block_size')::bigint as page_size" };
  }

  if (/^PRAGMA\s+page_count/i.test(raw)) {
    return {
      text: "select ceil(pg_database_size(current_database())::numeric / current_setting('block_size')::numeric)::bigint as page_count"
    };
  }

  if (/^PRAGMA\s+freelist_count/i.test(raw)) {
    return { text: "select 0::bigint as freelist_count" };
  }

  if (/^VACUUM\s+INTO\b/i.test(raw)) {
    const error = new Error("VACUUM INTO is not supported on PostgreSQL");
    error.code = "PG_UNSUPPORTED_SQLITE_COMMAND";
    throw error;
  }

  return { text: replaceSqliteSyntax(raw) };
}

function inferIdentityColumn(sql) {
  const match = /^\s*insert\s+into\s+(?:public\.)?"?([A-Za-z0-9_]+)"?/i.exec(sql);
  if (!match) {
    return null;
  }
  const tableName = match[1];
  const identityColumn = IDENTITY_COLUMNS.get(tableName);
  if (!identityColumn) {
    return null;
  }
  return { tableName, identityColumn };
}

async function runQuery(pool, sql, params) {
  const transformed = transformSql(sql);
  const client = getClient(pool);
  return client.query(transformed.text, params);
}

async function beginTransaction(pool) {
  if (getActiveTransaction()) {
    throw new Error("Nested transactions are not supported by the Postgres compatibility layer.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
  } catch (error) {
    client.release();
    throw error;
  }

  txStorage.enterWith({ client });
  return { changes: 0 };
}

async function finishTransaction(command) {
  const tx = getActiveTransaction();
  if (!tx) {
    return { changes: 0 };
  }

  try {
    const result = await tx.client.query(command);
    return { changes: result.rowCount || 0 };
  } finally {
    tx.client.release();
    txStorage.enterWith(null);
  }
}

async function ensureSchema(pool, schemaPath) {
  if (!schemaPath || !fs.existsSync(schemaPath)) {
    return;
  }
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  if (!schemaSql.trim()) {
    return;
  }
  await pool.query(schemaSql);
}

async function createPostgresCompatDb(options) {
  const connectionString = options?.connectionString;
  if (!connectionString) {
    throw new Error("Missing PostgreSQL connection string.");
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    ssl: (connectionString.includes("supabase.co") || connectionString.includes("supabase.com")) 
      ? { rejectUnauthorized: false } 
      : undefined
  });

  try {
    await pool.query("select 1");
  } catch (err) {
    console.error("Database validation query failed:", err);
    throw err;
  }
  await ensureSchema(pool, options?.schemaPath);

  return {
    kind: "postgres",
    async run(sql, ...rawParams) {
      const params = normalizeParams(rawParams);
      const trimmed = String(sql || "").trim();

      if (/^BEGIN(\s|;|$)/i.test(trimmed) || /^BEGIN IMMEDIATE/i.test(trimmed)) {
        return beginTransaction(pool);
      }
      if (/^COMMIT(\s|;|$)/i.test(trimmed)) {
        return finishTransaction("COMMIT");
      }
      if (/^ROLLBACK(\s|;|$)/i.test(trimmed)) {
        return finishTransaction("ROLLBACK");
      }

      let queryText = sql;
      let lastIdAlias = null;
      const identityInfo = /^\s*insert\b/i.test(trimmed) && !/\breturning\b/i.test(trimmed)
        ? inferIdentityColumn(trimmed)
        : null;

      if (identityInfo) {
        lastIdAlias = "__last_id__";
        const transformed = transformSql(trimmed).text;
        queryText = `${transformed} returning ${quoteIdent(identityInfo.identityColumn)} as ${quoteIdent(lastIdAlias)}`;
      }

      const result = identityInfo
        ? await getClient(pool).query(queryText, params)
        : await runQuery(pool, sql, params);

      const lastID = lastIdAlias && result.rows.length
        ? Number(result.rows[result.rows.length - 1][lastIdAlias])
        : undefined;

      return {
        lastID,
        changes: result.rowCount || 0
      };
    },
    async get(sql, ...rawParams) {
      const params = normalizeParams(rawParams);
      const result = await runQuery(pool, sql, params);
      return result.rows[0];
    },
    async all(sql, ...rawParams) {
      const params = normalizeParams(rawParams);
      const result = await runQuery(pool, sql, params);
      return result.rows;
    },
    async exec(sql) {
      const trimmed = String(sql || "").trim();
      if (/^BEGIN(\s|;|$)/i.test(trimmed) || /^BEGIN IMMEDIATE/i.test(trimmed)) {
        await beginTransaction(pool);
        return;
      }
      if (/^COMMIT(\s|;|$)/i.test(trimmed)) {
        await finishTransaction("COMMIT");
        return;
      }
      if (/^ROLLBACK(\s|;|$)/i.test(trimmed)) {
        await finishTransaction("ROLLBACK");
        return;
      }
      await runQuery(pool, sql, []);
    },
    async close() {
      await pool.end();
    }
  };
}

module.exports = {
  createPostgresCompatDb
};
