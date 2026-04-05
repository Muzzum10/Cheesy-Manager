"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = path.join(ROOT_DIR, "auction_v2.sqlite");
const DEFAULT_MANIFEST_PATH = path.join(ROOT_DIR, "supabase", "sqlite-migration", "manifest.json");
const DEFAULT_BATCH_TARGET_BYTES = 200000;
const ORPHAN_RULES = new Map([
  [
    "potd_poll_candidates",
    {
      parentTable: "potd_polls",
      childColumns: ["poll_id"],
      parentColumns: ["id"],
      archiveTable: "sqlite_orphan_potd_poll_candidates",
      note: "Missing parent potd_polls row in SQLite source"
    }
  ],
  [
    "team_vice_captains",
    {
      parentTable: "teams",
      childColumns: ["guild_id", "team_id"],
      parentColumns: ["guild_id", "team_id"],
      archiveTable: "sqlite_orphan_team_vice_captains",
      note: "Missing parent teams row in SQLite source"
    }
  ]
]);

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) {
    return `\\x${value.toString("hex")}`;
  }
  return value;
}

function buildOrderByClause(columns) {
  if (!columns.length) {
    return "";
  }
  return ` ORDER BY ${columns.map((column) => quoteIdent(column)).join(", ")}`;
}

function getPreferredBatchRowLimit(tableName) {
  if (tableName === "hc_auto_message_versions") {
    return 10;
  }
  if (tableName === "hc_matchup_match_log") {
    return 100;
  }
  return 200;
}

function createCompositeKey(row, columns) {
  return JSON.stringify(columns.map((column) => row[column] ?? null));
}

async function readJsonResponse(response) {
  const bodyText = await response.text();
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`Non-JSON response (${response.status}): ${bodyText}`);
  }
}

async function callRpc(baseUrl, apiKey, functionName, payload) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`RPC ${functionName} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function getPrimaryKeyColumns(db, tableName) {
  const columns = await db.all(`PRAGMA table_info(${quoteLiteral(tableName)})`);
  return columns
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name);
}

async function loadTableRows(db, tableName) {
  const primaryKeyColumns = await getPrimaryKeyColumns(db, tableName);
  const rows = await db.all(`SELECT * FROM ${quoteIdent(tableName)}${buildOrderByClause(primaryKeyColumns)}`);
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  });
}

async function loadParentKeySet(db, cache, tableName, columns) {
  const cacheKey = `${tableName}:${columns.join(",")}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const selectColumns = columns.map((column) => quoteIdent(column)).join(", ");
  const rows = await db.all(`SELECT ${selectColumns} FROM ${quoteIdent(tableName)}`);
  const values = new Set(rows.map((row) => createCompositeKey(row, columns)));
  cache.set(cacheKey, values);
  return values;
}

async function splitRowsByOrphanRule(db, cache, tableName, rows) {
  const rule = ORPHAN_RULES.get(tableName);
  if (!rule || !rows.length) {
    return { mainRows: rows, orphanRows: [], archiveTable: null };
  }

  const parentKeys = await loadParentKeySet(db, cache, rule.parentTable, rule.parentColumns);
  const mainRows = [];
  const orphanRows = [];

  for (const row of rows) {
    const hasNullKey = rule.childColumns.some((column) => row[column] == null);
    if (hasNullKey || parentKeys.has(createCompositeKey(row, rule.childColumns))) {
      mainRows.push(row);
      continue;
    }

    orphanRows.push({
      ...row,
      migration_note: rule.note
    });
  }

  return {
    mainRows,
    orphanRows,
    archiveTable: rule.archiveTable
  };
}

async function importTable(baseUrl, apiKey, tableName, rows, batchTargetBytes) {
  if (!rows.length) {
    return 0;
  }

  let imported = 0;
  let batch = [];
  let batchBytes = 2;
  const preferredBatchRowLimit = getPreferredBatchRowLimit(tableName);

  async function flush() {
    if (!batch.length) {
      return;
    }

    const result = await callRpc(baseUrl, apiKey, "import_json_rows", {
      target_table: tableName,
      rows_json: batch
    });

    if (Number(result) !== batch.length) {
      throw new Error(`Unexpected inserted count for ${tableName}: expected ${batch.length}, got ${result}`);
    }

    imported += batch.length;
    batch = [];
    batchBytes = 2;
  }

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    const wouldExceedLimit = batch.length && (batchBytes + rowBytes + 1 > batchTargetBytes);
    const wouldExceedRowLimit = batch.length >= preferredBatchRowLimit;

    if (wouldExceedLimit || wouldExceedRowLimit) {
      await flush();
    }

    batch.push(row);
    batchBytes += rowBytes + 1;
  }

  await flush();
  return imported;
}

async function setIdentityValues(baseUrl, apiKey, identities) {
  for (const identity of identities) {
    await callRpc(baseUrl, apiKey, "set_identity_value", {
      target_table: identity.table,
      target_column: identity.column,
      target_value: identity.value
    });
  }
}

async function main() {
  const sqlitePath = path.resolve(process.argv[2] || DEFAULT_DB_PATH);
  const manifestPath = path.resolve(process.argv[3] || DEFAULT_MANIFEST_PATH);
  const baseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const batchTargetBytes = Number(process.env.SUPABASE_IMPORT_BATCH_BYTES || DEFAULT_BATCH_TARGET_BYTES);

  if (!baseUrl) {
    throw new Error("SUPABASE_URL is required");
  }
  if (!apiKey) {
    throw new Error("SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY is required");
  }
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const db = await open({
    filename: sqlitePath,
    driver: sqlite3.Database
  });

  try {
    let importedRows = 0;
    let archivedRows = 0;
    const parentKeyCache = new Map();
    for (const tableEntry of manifest.tableCounts) {
      if (!tableEntry.rowCount) {
        continue;
      }

      const rows = await loadTableRows(db, tableEntry.table);
      const split = await splitRowsByOrphanRule(db, parentKeyCache, tableEntry.table, rows);
      const inserted = await importTable(baseUrl, apiKey, tableEntry.table, split.mainRows, batchTargetBytes);
      if (inserted !== split.mainRows.length) {
        throw new Error(`Import count mismatch for ${tableEntry.table}: expected ${split.mainRows.length}, got ${inserted}`);
      }

      importedRows += inserted;
      console.log(`Imported ${inserted} rows into ${tableEntry.table}`);

      if (split.orphanRows.length) {
        const archived = await importTable(baseUrl, apiKey, split.archiveTable, split.orphanRows, batchTargetBytes);
        if (archived !== split.orphanRows.length) {
          throw new Error(`Archive count mismatch for ${tableEntry.table}: expected ${split.orphanRows.length}, got ${archived}`);
        }
        archivedRows += archived;
        console.log(`Archived ${archived} orphan rows from ${tableEntry.table} into ${split.archiveTable}`);
      }
    }

    await setIdentityValues(baseUrl, apiKey, manifest.identities || []);
    console.log(JSON.stringify({
      importedRows,
      archivedRows,
      expectedRows: manifest.totalRows,
      tables: manifest.tables
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
