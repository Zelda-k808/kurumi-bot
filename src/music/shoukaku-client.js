/* ───────────── Shoukaku Client — Lavalink connection manager ───────────── */

const { Shoukaku, Connectors } = require("shoukaku");

const LAVALINK_HOST = (process.env.LAVALINK_HOST || "127.0.0.1").trim();
const LAVALINK_PORT = parseInt(process.env.LAVALINK_PORT, 10) || 2333;
const LAVALINK_PASS = (process.env.LAVALINK_PASSWORD || "kurumi-music-2024").trim();
const LAVALINK_SECURE = (process.env.LAVALINK_SECURE || "").trim().toLowerCase() === "true";
const LAVALINK_NAME = "Kurumi-Lavalink";

/** @type {Shoukaku | null} */
let shoukaku = null;

/**
 * Initialize Shoukaku and connect to Lavalink node(s).
 * Must be called AFTER client.login() resolves.
 * @param {import("discord.js").Client} client
 * @returns {Shoukaku}
 */
function init(client) {
  if (shoukaku) return shoukaku;

  const nodes = [{
    name: LAVALINK_NAME,
    url: `${LAVALINK_HOST}:${LAVALINK_PORT}`,
    auth: LAVALINK_PASS,
    secure: LAVALINK_SECURE,
  }];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: false,
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5000,
  });

  shoukaku.on("ready", (name) => {
    console.log(`[music] Lavalink node "${name}" is ready`);
  });

  shoukaku.on("error", (name, error) => {
    console.error(`[music] Lavalink node "${name}" error:`, error?.message || error);
  });

  shoukaku.on("close", (name, code, reason) => {
    console.warn(`[music] Lavalink node "${name}" closed (code=${code}, reason=${reason})`);
  });

  shoukaku.on("disconnect", (name, players, moved) => {
    console.warn(`[music] Lavalink node "${name}" disconnected (players=${players.size}, moved=${moved})`);
  });

  return shoukaku;
}

/**
 * Get the Shoukaku instance (must call init() first).
 * @returns {Shoukaku}
 */
function getShoukaku() {
  if (!shoukaku) throw new Error("[music] Shoukaku not initialized — call init(client) first");
  return shoukaku;
}

/**
 * Get an ideal Lavalink node for a new player.
 * @returns {import("shoukaku").Node}
 */
function getNode() {
  const sk = getShoukaku();
  const node = sk.options?.nodeResolver?.(sk.nodes) ?? sk.nodes.values().next().value;
  if (!node) throw new Error("[music] No Lavalink nodes available");
  return node;
}

/**
 * Check if Lavalink is connected and ready.
 * @returns {boolean}
 */
function isReady() {
  if (!shoukaku) return false;
  for (const node of shoukaku.nodes.values()) {
    if (node.state === 1) return true; // CONNECTED
  }
  return false;
}

module.exports = { init, getShoukaku, getNode, isReady };
