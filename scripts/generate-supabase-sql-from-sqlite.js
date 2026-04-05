"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = path.join(ROOT_DIR, "auction_v2.sqlite");
const OUTPUT_DIR = path.join(ROOT_DIR, "supabase", "sqlite-migration");
const SCHEMA_PATH = path.join(ROOT_DIR, "supabase", "migrations", "202604040001_init_from_sqlite.sql");
const DATA_PATH = path.join(OUTPUT_DIR, "202604040002_import_data.sql");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const CHUNK_TARGET_BYTES = 200000;

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeDefault(value) {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  if (/^'.*'$/.test(trimmed)) {
    return trimmed;
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return quoteLiteral(trimmed);
}

function mapSqliteType(typeName) {
  const normalized = String(typeName || "").trim().toUpperCase();
  if (!normalized) {
    return "text";
  }
  if (normalized.includes("INT")) {
    return "bigint";
  }
  if (normalized.includes("REAL") || normalized.includes("FLOA") || normalized.includes("DOUB")) {
    return "double precision";
  }
  if (normalized.includes("BLOB")) {
    return "bytea";
  }
  return "text";
}

function serializeValue(value) {
  if (value == null) {
    return "NULL";
  }
  if (Buffer.isBuffer(value)) {
    return `'\\x${value.toString("hex")}'`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot serialize non-finite number: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return quoteLiteral(value);
}

function groupForeignKeys(foreignKeys) {
  const groups = new Map();
  for (const foreignKey of foreignKeys || []) {
    const key = `${foreignKey.id}:${foreignKey.table}`;
    if (!groups.has(key)) {
      groups.set(key, {
        table: foreignKey.table,
        from: [],
        to: [],
        onDelete: foreignKey.on_delete,
        onUpdate: foreignKey.on_update
      });
    }
    const entry = groups.get(key);
    entry.from[foreignKey.seq] = foreignKey.from;
    entry.to[foreignKey.seq] = foreignKey.to;
  }
  return [...groups.values()].map((group) => ({
    table: group.table,
    from: group.from.filter(Boolean),
    to: group.to.filter(Boolean),
    onDelete: group.onDelete,
    onUpdate: group.onUpdate
  }));
}

function normalizeColumnSet(columns) {
  return columns.map((column) => String(column)).join("|");
}

function buildOrderByClause(columns) {
  if (!Array.isArray(columns) || !columns.length) {
    return "";
  }
  return ` ORDER BY ${columns.map((column) => quoteIdent(column)).join(", ")}`;
}

function topologicalSort(tableMap) {
  const dependencies = new Map();
  for (const [tableName, table] of tableMap.entries()) {
    const refs = new Set();
    for (const foreignKey of table.foreignKeyGroups) {
      if (foreignKey.table !== tableName && tableMap.has(foreignKey.table)) {
        refs.add(foreignKey.table);
      }
    }
    dependencies.set(tableName, refs);
  }

  const result = [];
  const pending = new Set(tableMap.keys());
  while (pending.size) {
    const ready = [...pending].filter((tableName) => {
      for (const dependency of dependencies.get(tableName) || []) {
        if (pending.has(dependency)) {
          return false;
        }
      }
      return true;
    }).sort();

    if (!ready.length) {
      result.push(...[...pending].sort());
      break;
    }

    for (const tableName of ready) {
      pending.delete(tableName);
      result.push(tableName);
    }
  }

  return result;
}

async function loadSchema(db) {
  const tables = await db.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);

  const sqliteSequences = await db.all("SELECT name, seq FROM sqlite_sequence ORDER BY name").catch(() => []);
  const identityByTable = new Map(sqliteSequences.map((row) => [row.name, row.seq]));
  const tableMap = new Map();

  for (const table of tables) {
    const columns = await db.all(`PRAGMA table_info(${quoteLiteral(table.name)})`);
    const rawForeignKeys = await db.all(`PRAGMA foreign_key_list(${quoteLiteral(table.name)})`);
    const indexes = await db.all(`PRAGMA index_list(${quoteLiteral(table.name)})`);
    const indexDetails = [];

    for (const index of indexes) {
      const indexColumns = await db.all(`PRAGMA index_info(${quoteLiteral(index.name)})`);
      indexDetails.push({
        name: index.name,
        unique: Number(index.unique) === 1,
        origin: index.origin,
        columns: indexColumns.sort((a, b) => a.seqno - b.seqno).map((item) => item.name)
      });
    }

    const primaryKeyColumns = columns
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((column) => column.name);

    const uniqueColumnSets = new Set();
    if (primaryKeyColumns.length) {
      uniqueColumnSets.add(normalizeColumnSet(primaryKeyColumns));
    }

    for (const index of indexDetails) {
      if (index.unique && index.columns.length) {
        uniqueColumnSets.add(normalizeColumnSet(index.columns));
      }
    }

    tableMap.set(table.name, {
      name: table.name,
      sql: table.sql,
      columns,
      identityColumn: identityByTable.has(table.name)
        ? columns.find((column) => Number(column.pk) === 1)?.name || null
        : null,
      identityValue: identityByTable.get(table.name) || null,
      primaryKeyColumns,
      foreignKeyGroups: groupForeignKeys(rawForeignKeys),
      indexes: indexDetails,
      uniqueColumnSets
    });
  }

  const supplementalUniqueIndexes = [];
  for (const table of tableMap.values()) {
    for (const foreignKey of table.foreignKeyGroups) {
      const referencedTable = tableMap.get(foreignKey.table);
      if (!referencedTable) {
        continue;
      }
      const targetSet = normalizeColumnSet(foreignKey.to);
      if (referencedTable.uniqueColumnSets.has(targetSet)) {
        continue;
      }
      referencedTable.uniqueColumnSets.add(targetSet);
      supplementalUniqueIndexes.push({
        table: referencedTable.name,
        columns: foreignKey.to
      });
    }
  }

  return {
    tableMap,
    tableOrder: topologicalSort(tableMap),
    supplementalUniqueIndexes
  };
}

function buildCreateTableSql(table) {
  const lines = [];
  const singlePrimaryKey = table.primaryKeyColumns.length === 1 ? table.primaryKeyColumns[0] : null;

  for (const column of table.columns) {
    const parts = [quoteIdent(column.name)];
    const isIdentityColumn = table.identityColumn === column.name && singlePrimaryKey === column.name;

    if (isIdentityColumn) {
      parts.push("bigint generated by default as identity");
    } else {
      parts.push(mapSqliteType(column.type));
    }

    const defaultValue = normalizeDefault(column.dflt_value);
    if (defaultValue) {
      parts.push(`default ${defaultValue}`);
    }

    if (Number(column.notnull) === 1 || Number(column.pk) > 0) {
      parts.push("not null");
    }

    if (singlePrimaryKey === column.name) {
      parts.push("primary key");
    }

    lines.push(`  ${parts.join(" ")}`);
  }

  if (table.primaryKeyColumns.length > 1) {
    lines.push(`  primary key (${table.primaryKeyColumns.map((column) => quoteIdent(column)).join(", ")})`);
  }

  for (const foreignKey of table.foreignKeyGroups) {
    const pieces = [
      `foreign key (${foreignKey.from.map((column) => quoteIdent(column)).join(", ")})`,
      `references public.${quoteIdent(foreignKey.table)} (${foreignKey.to.map((column) => quoteIdent(column)).join(", ")})`
    ];

    if (foreignKey.onDelete && foreignKey.onDelete !== "NO ACTION") {
      pieces.push(`on delete ${foreignKey.onDelete.toLowerCase()}`);
    }
    if (foreignKey.onUpdate && foreignKey.onUpdate !== "NO ACTION") {
      pieces.push(`on update ${foreignKey.onUpdate.toLowerCase()}`);
    }

    lines.push(`  ${pieces.join(" ")}`);
  }

  return [
    `create table if not exists public.${quoteIdent(table.name)} (`,
    lines.join(",\n"),
    ");"
  ].join("\n");
}

function buildIndexSql(table, supplementalUniqueIndexes) {
  const statements = [];

  for (const index of table.indexes) {
    if (!index.columns.length || index.origin === "pk") {
      continue;
    }
    const uniqueSql = index.unique ? "unique " : "";
    statements.push(
      `create ${uniqueSql}index if not exists ${quoteIdent(index.name)} on public.${quoteIdent(table.name)} (${index.columns.map((column) => quoteIdent(column)).join(", ")});`
    );
  }

  for (const supplemental of supplementalUniqueIndexes) {
    if (supplemental.table !== table.name) {
      continue;
    }
    const indexName = `uq_${table.name}_${supplemental.columns.join("_")}`;
    statements.push(
      `create unique index if not exists ${quoteIdent(indexName)} on public.${quoteIdent(table.name)} (${supplemental.columns.map((column) => quoteIdent(column)).join(", ")});`
    );
  }

  return statements;
}

async function buildDataSql(db, schema) {
    const insertStatements = [];
    const tableCounts = [];
    const perTableSql = [];

    for (const tableName of schema.tableOrder) {
        const table = schema.tableMap.get(tableName);
        const countRow = await db.get(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)}`);
        const rowCount = Number(countRow?.count || 0);
        tableCounts.push({ table: tableName, rowCount });

        if (!rowCount) {
            perTableSql.push({ table: tableName, sql: "" });
            continue;
        }

        const orderColumns = table.primaryKeyColumns.length
            ? table.primaryKeyColumns
            : table.identityColumn
                ? [table.identityColumn]
                : [];

        const rows = await db.all(`SELECT * FROM ${quoteIdent(tableName)}${buildOrderByClause(orderColumns)}`);
        const columnNames = table.columns.map((column) => column.name);
        const columnList = columnNames.map((column) => quoteIdent(column)).join(", ");
        const batchSize = tableName === "hc_auto_message_versions"
            ? 10
            : tableName === "hc_matchup_match_log"
                ? 100
                : 200;
        const tableStatements = [];

        for (let index = 0; index < rows.length; index += batchSize) {
            const batch = rows.slice(index, index + batchSize);
            const valuesSql = batch.map((row) => {
                const serialized = columnNames.map((column) => serializeValue(row[column]));
                return `(${serialized.join(", ")})`;
            });

            const statement = (
                `insert into public.${quoteIdent(tableName)} (${columnList}) values\n${valuesSql.join(",\n")};`
            );
            insertStatements.push(statement);
            tableStatements.push(statement);
        }

        perTableSql.push({
            table: tableName,
            sql: tableStatements.join("\n\n")
        });
    }

    const sequenceStatements = [];
    for (const table of schema.tableMap.values()) {
        if (!table.identityColumn || table.identityValue == null) {
      continue;
    }
    sequenceStatements.push(
      `select setval(pg_get_serial_sequence('public.${table.name}', '${table.identityColumn}'), ${Number(table.identityValue)}, true);`
    );
  }

    return {
        tableCounts,
        perTableSql,
        dataSql: [
            "begin;",
            ...insertStatements,
            ...sequenceStatements,
            "commit;"
    ].join("\n\n")
  };
}

async function main() {
  const sqlitePath = path.resolve(process.argv[2] || DEFAULT_DB_PATH);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const db = await open({
    filename: sqlitePath,
    driver: sqlite3.Database
  });

  try {
    const schema = await loadSchema(db);
    const schemaStatements = [];
    for (const tableName of schema.tableOrder) {
      const table = schema.tableMap.get(tableName);
      schemaStatements.push(buildCreateTableSql(table));
      schemaStatements.push(...buildIndexSql(table, schema.supplementalUniqueIndexes));
    }

    const { tableCounts, dataSql, perTableSql } = await buildDataSql(db, schema);
    const totalRows = tableCounts.reduce((sum, entry) => sum + entry.rowCount, 0);
    const manifest = {
      generatedAt: new Date().toISOString(),
      sqlitePath,
      tables: tableCounts.length,
      totalRows,
      tableCounts,
      identities: [...schema.tableMap.values()]
        .filter((table) => table.identityColumn)
        .map((table) => ({
          table: table.name,
          column: table.identityColumn,
          value: table.identityValue
        }))
    };

    const tablesDir = path.join(OUTPUT_DIR, "tables");
    const chunksDir = path.join(OUTPUT_DIR, "chunks");
    fs.mkdirSync(path.dirname(SCHEMA_PATH), { recursive: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.rmSync(tablesDir, { recursive: true, force: true });
    fs.rmSync(chunksDir, { recursive: true, force: true });
    fs.mkdirSync(tablesDir, { recursive: true });
    fs.mkdirSync(chunksDir, { recursive: true });

    fs.writeFileSync(
      SCHEMA_PATH,
      [
        "-- Generated from auction_v2.sqlite by scripts/generate-supabase-sql-from-sqlite.js",
        "create schema if not exists public;",
        "",
        schemaStatements.join("\n\n")
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(DATA_PATH, dataSql, "utf8");
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
    for (const [index, item] of perTableSql.entries()) {
        if (!item.sql) {
            continue;
        }
        const fileName = `${String(index + 1).padStart(3, "0")}_${item.table}.sql`;
        fs.writeFileSync(path.join(tablesDir, fileName), item.sql, "utf8");
        const tableChunkDir = path.join(chunksDir, item.table);
        fs.mkdirSync(tableChunkDir, { recursive: true });
        const statements = item.sql
            .split(/;\n\n/g)
            .map((statement) => statement.trim())
            .filter(Boolean)
            .map((statement) => `${statement};`);
        let chunkStatements = [];
        let chunkLength = 0;
        let chunkIndex = 1;
        for (const statement of statements) {
            const nextLength = chunkLength + statement.length + 2;
            if (chunkStatements.length && nextLength > CHUNK_TARGET_BYTES) {
                fs.writeFileSync(path.join(tableChunkDir, `${String(chunkIndex).padStart(3, "0")}.sql`), chunkStatements.join("\n\n"), "utf8");
                chunkStatements = [];
                chunkLength = 0;
                chunkIndex += 1;
            }
            chunkStatements.push(statement);
            chunkLength += statement.length + 2;
        }
        if (chunkStatements.length) {
            fs.writeFileSync(path.join(tableChunkDir, `${String(chunkIndex).padStart(3, "0")}.sql`), chunkStatements.join("\n\n"), "utf8");
        }
    }

    console.log(JSON.stringify({
        schemaPath: path.relative(ROOT_DIR, SCHEMA_PATH),
        dataPath: path.relative(ROOT_DIR, DATA_PATH),
        manifestPath: path.relative(ROOT_DIR, MANIFEST_PATH),
      tables: manifest.tables,
      totalRows: manifest.totalRows
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
