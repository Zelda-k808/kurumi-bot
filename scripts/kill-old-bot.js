/**
 * kill-old-bot.js — runs as `prestart` to kill any previous bot instance
 * before npm start launches a new one. Uses a .bot.pid file.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PID_FILE = path.join(__dirname, "..", ".bot.pid");

try {
  if (!fs.existsSync(PID_FILE)) {
    process.exit(0);
  }

  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const oldPid = parseInt(raw, 10);

  if (!oldPid || isNaN(oldPid)) {
    fs.unlinkSync(PID_FILE);
    process.exit(0);
  }

  // Check if the process is still alive
  let alive = false;
  try {
    process.kill(oldPid, 0); // signal 0 = existence check, doesn't kill
    alive = true;
  } catch (_) {
    // ESRCH = process doesn't exist — already gone
  }

  if (alive) {
    console.log(`[startup] Killing old bot instance (PID ${oldPid})…`);
    try {
      if (process.platform === "win32") {
        // /T = kill child processes, /F = force
        execSync(`taskkill /PID ${oldPid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(oldPid, "SIGTERM");
      }
      console.log(`[startup] Old instance (PID ${oldPid}) killed.`);
    } catch (e) {
      console.warn(`[startup] Could not kill PID ${oldPid}: ${e.message}`);
    }

    // Brief pause to let the port/socket release
    execSync(
      process.platform === "win32"
        ? "ping -n 2 127.0.0.1 >nul"
        : "sleep 1",
      { stdio: "ignore" }
    );
  }

  // Clean up stale PID file
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {}
} catch (e) {
  console.warn(`[startup] PID cleanup error: ${e.message}`);
}
