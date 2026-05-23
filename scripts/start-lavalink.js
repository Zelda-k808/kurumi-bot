/**
 * start-lavalink.js — Spawns Lavalink as a child process, waits for it to be
 * ready, then optionally starts the bot. Used by `npm run lavalink` and `npm run dev`.
 *
 * Usage:
 *   node scripts/start-lavalink.js           → Lavalink only
 *   node scripts/start-lavalink.js --bot      → Lavalink + bot
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const LAVALINK_DIR = path.join(__dirname, "..", "lavalink");
const JAR_PATH = path.join(LAVALINK_DIR, "Lavalink.jar");
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1500;
const LAVALINK_PORT = parseInt(process.env.LAVALINK_PORT, 10) || 2333;

const startBot = process.argv.includes("--bot");

const LAVALINK_PASS = process.env.LAVALINK_PASSWORD || "kurumi-music-2024";

function probeLavalink() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${LAVALINK_PORT}/version`, {
      headers: { "Authorization": LAVALINK_PASS },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(res.statusCode === 200));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForReady() {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (await probeLavalink()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  if (!fs.existsSync(JAR_PATH)) {
    console.error("[lavalink] Lavalink.jar not found. Run: npm run lavalink:setup");
    process.exit(1);
  }

  console.log(`[lavalink] Starting Lavalink server (port ${LAVALINK_PORT})…`);

  const lavalink = spawn("java", [
    "-Xmx256m",
    "-jar", "Lavalink.jar",
  ], {
    cwd: LAVALINK_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Prefix Lavalink output
  lavalink.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`[lavalink] ${line}`);
    }
  });
  lavalink.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.error(`[lavalink] ${line}`);
    }
  });

  let botProcess = null;

  lavalink.on("exit", (code, signal) => {
    console.log(`[lavalink] exited (code=${code}, signal=${signal})`);
    if (botProcess) {
      try { botProcess.kill("SIGTERM"); } catch (_) {}
    }
    process.exit(code ?? 1);
  });

  // Wait for Lavalink to become ready
  const ready = await waitForReady();
  if (!ready) {
    console.error("[lavalink] Timed out waiting for Lavalink to start.");
    lavalink.kill("SIGTERM");
    process.exit(1);
  }

  console.log("[lavalink] ✓ Lavalink is ready!");


  if (startBot) {
    console.log("[lavalink] Starting bot…\n");
    botProcess = spawn("node", ["src/index.js"], {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: { ...process.env },
    });

    botProcess.on("exit", (code) => {
      console.log(`[bot] exited (code=${code})`);
      lavalink.kill("SIGTERM");
      process.exit(code ?? 0);
    });
  }

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n[lavalink] ${signal} — shutting down…`);
    if (botProcess) {
      try { botProcess.kill("SIGTERM"); } catch (_) {}
    }
    lavalink.kill("SIGTERM");
    setTimeout(() => process.exit(0), 3000);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[lavalink] Fatal:", err);
  process.exit(1);
});
