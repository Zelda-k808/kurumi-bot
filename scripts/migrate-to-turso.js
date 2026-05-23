#!/usr/bin/env node
/**
 * migrate-to-turso.js — One-time migration from local SQLite (better-sqlite3) to Turso.
 *
 * Usage:
 *   1. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env (or export them).
 *   2. npm run migrate:turso
 *
 * This reads data/kurumi.db with better-sqlite3 (devDependency) and pushes all rows
 * to the Turso cloud database using @libsql/client.
 */

require("dotenv").config({ override: false });

const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "kurumi.db");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No local database found at ${DB_PATH} — nothing to migrate.`);
  process.exit(0);
}

const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();

if (!TURSO_URL) {
  console.error("TURSO_DATABASE_URL is not set. Add it to .env first.");
  process.exit(1);
}

async function main() {
  // ── Source: local SQLite via better-sqlite3 ──
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error("better-sqlite3 not found. Install it: npm install --save-dev better-sqlite3");
    process.exit(1);
  }
  const local = new Database(DB_PATH, { readonly: true });

  // ── Target: Turso cloud ──
  const { createClient } = require("@libsql/client");
  const remote = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN || undefined,
  });

  console.log(`Source: ${DB_PATH}`);
  console.log(`Target: ${TURSO_URL}`);
  console.log();

  // ── Create schema on Turso ──
  const db = require("../src/database");
  await db.init();
  console.log("Schema created on Turso.\n");

  // ── Tables to migrate ──
  const tables = [
    "users",
    "user_prefs",
    "wordle_stats",
    "wordle_games",
    "wordle_last_games",
    "daily_schedules",
    "daily_answers",
    "daily_progress",
    "chat_history",
    "bot_state",
    "user_voice_xp",
  ];

  for (const table of tables) {
    let rows;
    try {
      rows = local.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      console.log(`⚠ Table "${table}" not found locally — skipping.`);
      continue;
    }

    if (!rows.length) {
      console.log(`○ ${table}: 0 rows (empty)`);
      continue;
    }

    // Get column names from the first row
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.join(", ");
    const conflictCols = getConflictColumns(table);
    const sql = conflictCols
      ? `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`
      : `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;

    // Batch insert in chunks of 20 (Turso batch limit is generous but let's be safe)
    const CHUNK = 20;
    let migrated = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const stmts = chunk.map((row) => ({
        sql,
        args: cols.map((c) => row[c] ?? null),
      }));
      await remote.batch(stmts, "write");
      migrated += chunk.length;
    }

    console.log(`✓ ${table}: ${migrated} rows migrated`);
  }

  // ── Verify ──
  console.log("\nVerifying row counts...");
  let allMatch = true;
  for (const table of tables) {
    let localCount;
    try {
      localCount = local.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    } catch {
      continue; // table didn't exist locally
    }
    const rs = await remote.execute(`SELECT COUNT(*) AS c FROM ${table}`);
    const remoteCount = rs.rows[0]?.c ?? 0;
    const match = Number(localCount) === Number(remoteCount);
    const icon = match ? "✓" : "✗";
    console.log(`  ${icon} ${table}: local=${localCount} remote=${remoteCount}`);
    if (!match) allMatch = false;
  }

  local.close();
  console.log();
  if (allMatch) {
    console.log("Migration complete — all row counts match!");
  } else {
    console.log("Migration complete — some counts differ (could be duplicate handling). Check above.");
  }
}

function getConflictColumns(table) {
  // Tables with primary keys where we want REPLACE behavior
  const pkTables = [
    "users", "user_prefs", "wordle_stats", "wordle_games", "wordle_last_games",
    "daily_schedules", "bot_state",
  ];
  return pkTables.includes(table);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
