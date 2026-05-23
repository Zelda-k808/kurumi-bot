/**
 * setup-lavalink.js — Downloads Lavalink v4.2.2 and verifies Java 17+.
 * Usage: npm run lavalink:setup
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const LAVALINK_VERSION = "4.2.2";
const LAVALINK_URL = `https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar`;
const LAVALINK_DIR = path.join(__dirname, "..", "lavalink");
const JAR_PATH = path.join(LAVALINK_DIR, "Lavalink.jar");

function checkJava() {
  try {
    const out = execSync("java -version 2>&1", { encoding: "utf-8" });
    const match = out.match(/version\s+"(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    if (major < 17) {
      console.error(`[lavalink:setup] Java ${major} found — Lavalink requires Java 17+.`);
      console.error("Install from: https://adoptium.net/");
      process.exit(1);
    }
    console.log(`[lavalink:setup] ✓ Java ${major} detected.`);
    return major;
  } catch (_) {
    console.error("[lavalink:setup] Java not found. Lavalink requires Java 17+.");
    console.error("Install from: https://adoptium.net/");
    process.exit(1);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[lavalink:setup] Downloading Lavalink v${LAVALINK_VERSION}…`);
    console.log(`  URL: ${url}`);

    const follow = (u) => {
      const proto = u.startsWith("https") ? https : require("http");
      proto.get(u, { headers: { "User-Agent": "kurumi-bot" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${u}`));
          return;
        }

        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        let lastPct = -1;

        const ws = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`  ${pct}% (${(downloaded / 1e6).toFixed(1)} MB)\n`);
              lastPct = pct;
            }
          }
        });
        res.pipe(ws);
        ws.on("finish", () => {
          ws.close();
          resolve();
        });
        ws.on("error", reject);
      }).on("error", reject);
    };

    follow(url);
  });
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Kurumi — Lavalink Setup v4.2.2     ║");
  console.log("╚══════════════════════════════════════╝\n");

  checkJava();

  if (!fs.existsSync(LAVALINK_DIR)) {
    fs.mkdirSync(LAVALINK_DIR, { recursive: true });
  }

  if (fs.existsSync(JAR_PATH)) {
    const stats = fs.statSync(JAR_PATH);
    const sizeMB = (stats.size / 1e6).toFixed(1);
    console.log(`[lavalink:setup] Lavalink.jar already exists (${sizeMB} MB).`);
    console.log("  Delete it and re-run to re-download.");
  } else {
    await download(LAVALINK_URL, JAR_PATH);
    const stats = fs.statSync(JAR_PATH);
    console.log(`[lavalink:setup] ✓ Downloaded Lavalink.jar (${(stats.size / 1e6).toFixed(1)} MB)`);
  }

  // Ensure application.yml exists
  const ymlPath = path.join(LAVALINK_DIR, "application.yml");
  if (!fs.existsSync(ymlPath)) {
    console.error("[lavalink:setup] ✗ application.yml not found in lavalink/");
    console.error("  Please create it — see docs or the template in the repo.");
    process.exit(1);
  }

  console.log("\n[lavalink:setup] ✓ Ready! Run: npm run lavalink");
  console.log("  Or use: npm run dev (starts Lavalink + bot together)\n");
}

main().catch((err) => {
  console.error("[lavalink:setup] Fatal:", err);
  process.exit(1);
});
