/**
 * failover.js — Manages Render standby / active state based on laptop heartbeats.
 *
 * On Render (RENDER_STANDBY=1):
 *   - The bot starts in standby mode (no Discord login).
 *   - The HTTP server stays up to receive heartbeats and stay alive.
 *   - When the laptop heartbeat goes stale (>STALE_MS), Render activates.
 *   - When a fresh heartbeat arrives, Render deactivates after a brief delay.
 *
 * On the laptop:
 *   - This module is not used; the heartbeat *sender* lives in index.js.
 */

"use strict";

/** How long before a heartbeat is considered stale (laptop offline). */
const STALE_MS = parseInt(process.env.FAILOVER_STALE_MS, 10) || 60_000;

/** How often the Render watcher loop checks the heartbeat. */
const CHECK_INTERVAL_MS = parseInt(process.env.FAILOVER_CHECK_MS, 10) || 10_000;

/** Delay before Render disconnects after a fresh heartbeat arrives (lets laptop stabilise). */
const HANDOFF_DELAY_MS = parseInt(process.env.FAILOVER_HANDOFF_MS, 10) || 5_000;

// ── Internal state ──────────────────────────────────────────────────
// Start with "now" so we give the laptop a full STALE_MS window to send
// its first heartbeat — prevents premature activation on cold boot.
let _lastHeartbeat = Date.now();
let _mode = "standby";         // "standby" | "active"
let _watcherTimer = null;      // setInterval handle
let _handoffTimer = null;      // setTimeout for delayed stand-down

// ── Public API ──────────────────────────────────────────────────────

/** Returns true when this process should operate in standby mode (Render only). */
function isStandbyEnabled() {
  return (
    process.env.RENDER_STANDBY === "1" ||
    process.env.RENDER_STANDBY === "true"
  );
}

/** Store a heartbeat timestamp from the laptop. */
function updateHeartbeat(epochMs) {
  _lastHeartbeat = typeof epochMs === "number" && epochMs > 0 ? epochMs : Date.now();
}

/** Is the laptop's heartbeat fresh (within STALE_MS)? */
function isLaptopAlive() {
  return Date.now() - _lastHeartbeat < STALE_MS;
}

/** Should Render activate? (heartbeat is stale or was never received) */
function shouldActivate() {
  return !isLaptopAlive();
}

/** Current mode: "standby" | "active". */
function getMode() {
  return _mode;
}

/** Debug snapshot for the /failover-status endpoint. */
function getStatus() {
  return {
    mode: _mode,
    standbyEnabled: isStandbyEnabled(),
    lastHeartbeat: _lastHeartbeat === 0 ? null : new Date(_lastHeartbeat).toISOString(),
    lastHeartbeatAgeMs: _lastHeartbeat === 0 ? null : Date.now() - _lastHeartbeat,
    staleTresholdMs: STALE_MS,
    laptopAlive: isLaptopAlive(),
  };
}

/**
 * Start the watcher loop.  Calls `onActivate()` when Render should log in,
 * and `onDeactivate()` when it should log out.
 *
 * @param {{ onActivate: () => Promise<void>, onDeactivate: () => Promise<void> }} cbs
 */
function startWatcher(cbs) {
  if (_watcherTimer) return; // already running

  console.log(
    `[failover] watcher started — stale=${STALE_MS}ms check=${CHECK_INTERVAL_MS}ms handoff=${HANDOFF_DELAY_MS}ms`
  );

  _watcherTimer = setInterval(async () => {
    try {
      if (_mode === "standby" && shouldActivate()) {
        // Laptop is gone → activate
        _mode = "active";
        console.log("[failover] laptop heartbeat stale — activating Render bot");
        if (_handoffTimer) {
          clearTimeout(_handoffTimer);
          _handoffTimer = null;
        }
        await cbs.onActivate();
      }
    } catch (err) {
      console.error("[failover] watcher error:", err);
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * Called when a heartbeat arrives while Render is active.
 * Schedules a delayed stand-down so the laptop gateway can stabilise first.
 *
 * @param {() => Promise<void>} onDeactivate
 */
function scheduleStandDown(onDeactivate) {
  if (_mode !== "active") return;
  if (_handoffTimer) return; // already scheduled

  console.log(
    `[failover] laptop heartbeat received while active — standing down in ${HANDOFF_DELAY_MS}ms`
  );

  _handoffTimer = setTimeout(async () => {
    _handoffTimer = null;
    if (!isLaptopAlive()) {
      console.log("[failover] laptop went stale again before handoff completed — staying active");
      return;
    }
    _mode = "standby";
    console.log("[failover] handing off to laptop — Render going standby");
    try {
      await onDeactivate();
    } catch (err) {
      console.error("[failover] deactivate error:", err);
    }
  }, HANDOFF_DELAY_MS);
}

/** Stop the watcher (for clean shutdown). */
function stopWatcher() {
  if (_watcherTimer) {
    clearInterval(_watcherTimer);
    _watcherTimer = null;
  }
  if (_handoffTimer) {
    clearTimeout(_handoffTimer);
    _handoffTimer = null;
  }
}

module.exports = {
  isStandbyEnabled,
  updateHeartbeat,
  isLaptopAlive,
  shouldActivate,
  getMode,
  getStatus,
  startWatcher,
  scheduleStandDown,
  stopWatcher,
  STALE_MS,
};
