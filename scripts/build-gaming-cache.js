#!/usr/bin/env node
/**
 * Expand data/gaming-cache.json via IGDB (Twitch credentials).
 * Register app: https://dev.twitch.tv/console → Confidential → OAuth redirect: localhost
 * Usage: IGDB_CLIENT_ID=xxx IGDB_CLIENT_SECRET=yyy node scripts/build-gaming-cache.js
 */
const fs = require("fs");
const path = require("path");
const igdb = require("../src/igdb-client");

const OUT = path.join(__dirname, "..", "data", "gaming-cache.json");
const PAGES = Number.parseInt(process.env.IGDB_PAGES || "10", 10);
const PAGE_SIZE = Number.parseInt(process.env.IGDB_PAGE_SIZE || "50", 10);

async function main() {
  if (!igdb.isConfigured()) {
    console.error(
      "Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET (Twitch Developer app — api-docs.igdb.com)"
    );
    process.exit(1);
  }

  const all = [];
  const seen = new Set();

  for (let page = 0; page < PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const batch = await igdb.fetchTopGames(PAGE_SIZE, offset);
    if (!batch.length) {
      console.warn("No more results at offset", offset);
      break;
    }
    for (const g of batch) {
      const k = g.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(g);
    }
    console.log(`page ${page + 1}/${PAGES} — ${all.length} unique games`);
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(`Wrote ${all.length} entries to ${OUT}`);
  console.log("Restart bot or gaming-knowledge.reload() after deploy.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
