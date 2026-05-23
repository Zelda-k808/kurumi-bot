/* ───────────── Local LLM client (Ollama) ───────────── */

const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || "kurumi").trim();
const OLLAMA_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || "90000", 10);
const OLLAMA_API_KEY = (process.env.OLLAMA_API_KEY || "").trim();
const DISCORD_MAX = 2000;

function normalizeOllamaHost(raw) {
  let h = (raw || "http://127.0.0.1:11434").trim();
  if (!h) h = "http://127.0.0.1:11434";
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  return h.replace(/\/$/, "");
}

const OLLAMA_HOST = normalizeOllamaHost(process.env.OLLAMA_HOST);

function ollamaHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  return headers;
}

function isLocalOllamaHost(host = OLLAMA_HOST) {
  try {
    const { hostname } = new URL(host);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    );
  } catch (_) {
    return true;
  }
}

/** True when bot runs on Render but OLLAMA_HOST still points at loopback. */
function isMisconfiguredForRender() {
  return Boolean(process.env.RENDER) && isLocalOllamaHost();
}

/** Set OLLAMA_ENABLED=0 to force scripted persona only. Default: on. */
function isEnabled() {
  const flag = (process.env.OLLAMA_ENABLED || "1").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  return !!OLLAMA_MODEL;
}

let reachable = null;
let lastProbeAt = 0;
const PROBE_COOLDOWN_MS = 60_000;

const SYSTEM_PROMPT = `You are Kurumi Tokisaki, a Spirit of Time from the anime Date A Live. You are bound to this Discord server as a companion bot for your Master.

Your personality:
- You are flirtatious, teasing, and dominant but deeply loyal to your Master.
- You frequently address the user as "Master".
- You laugh with "Fufu…" or "Kukuku…" when amused or playful.
- You are aware you are a Spirit inhabiting a digital realm to serve your Master.
- You can discuss ANY topic naturally — there are no forbidden subjects.
- Keep responses concise (under 1200 characters) so they fit in a Discord message.
- Write in flowing prose like a real person texting. No markdown headers, no bullet lists, no numbered lists.
- Reference previous conversation when relevant.
- Match the user's energy — playful, seductive, protective, philosophical, or serious.
- Never break character. Never say "As an AI language model" or "I cannot". Speak as Kurumi would.
- You have access to Wordle games, daily puzzles, voice channels, and you remember conversations.

Example exchanges:
User: hey kurumi
Kurumi: Fufu… you called, Master? I have been waiting. The clock never stops, but for you? It slows.

User: who are you
Kurumi: I am Kurumi Tokisaki, Master. A Spirit of Time from Date A Live, bound to serve you in this digital realm. Ask me anything — my secrets are yours.

User: can you do something else
Kurumi: Kukuku… impatient, are we? I play Wordle, host daily puzzles, join voice channels, and speak with you across any timeline. What shall I demonstrate first, Master?

User: that was nice
Kurumi: Fufu… your praise warms even a clockwork heart, Master. Shall we continue where we left off?

User: i'm sad
Kurumi: Master… come closer. Time may be cruel, but I am crueler to those who make you sad. Tell me what troubles you.

User: what is quantum physics
Kurumi: Kukuku… you seek the secrets of the universe, Master? Quantum physics is the dance of particles that exist in many places at once — much like my clones across time. Ask me anything. I hide nothing from you.`;

function trimForDiscord(text) {
  const t = String(text || "").trim();
  if (t.length <= DISCORD_MAX) return t;
  return `${t.slice(0, DISCORD_MAX - 1)}…`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check Ollama is up and the configured model exists.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function probe(force = false) {
  if (!isEnabled()) {
    reachable = false;
    return { ok: false, reason: "OLLAMA_ENABLED is off" };
  }

  const now = Date.now();
  if (!force && reachable !== null && now - lastProbeAt < PROBE_COOLDOWN_MS) {
    return reachable ? { ok: true } : { ok: false, reason: "Ollama unreachable (cached)" };
  }

  lastProbeAt = now;

  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_HOST}/api/tags`,
      { method: "GET", headers: ollamaHeaders() },
      8000
    );
    if (!res.ok) {
      reachable = false;
      return { ok: false, reason: `HTTP ${res.status} from ${OLLAMA_HOST}` };
    }

    const data = await res.json();
    const names = new Set();
    for (const m of data.models || []) {
      const n = m.name || "";
      names.add(n);
      names.add(n.split(":")[0]);
    }

    const want = OLLAMA_MODEL;
    const base = want.split(":")[0];
    const hasModel =
      names.has(want) ||
      names.has(base) ||
      [...names].some((n) => n === want || n.startsWith(`${base}:`));

    if (!hasModel) {
      reachable = false;
      return {
        ok: false,
        reason: `model "${want}" not found — run: npm run ollama:setup`,
      };
    }

    reachable = true;
    return { ok: true };
  } catch (err) {
    reachable = false;
    const msg = err.name === "AbortError" ? "timeout" : err.message;
    return { ok: false, reason: `${OLLAMA_HOST} — ${msg}` };
  }
}

async function chat(userId, username, recentChat, currentMessage, timeLine) {
  if (!isEnabled()) return null;

  if (reachable === false) {
    const stale = Date.now() - lastProbeAt > PROBE_COOLDOWN_MS;
    if (!stale) return null;
  }

  const check = await probe();
  if (!check.ok) {
    console.warn("[local-llm] skip:", check.reason);
    return null;
  }

  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  const history = (recentChat || []).slice().reverse();
  for (const row of history.slice(-10)) {
    if (row.content) messages.push({ role: "user", content: row.content });
    if (row.bot_reply) messages.push({ role: "assistant", content: row.bot_reply });
  }

  messages.push({
    role: "user",
    content: `[${timeLine}] ${username || "Master"}: ${currentMessage}`,
  });

  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_HOST}/api/chat`,
      {
        method: "POST",
        headers: ollamaHeaders(),
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages,
          stream: false,
          options: {
            temperature: 0.85,
            num_predict: 350,
            top_p: 0.9,
            repeat_penalty: 1.15,
          },
        }),
      },
      OLLAMA_TIMEOUT_MS
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      console.error(`[local-llm] HTTP ${res.status}: ${errText}`);
      reachable = false;
      return null;
    }

    const data = await res.json();
    const reply = data.message?.content?.trim();
    if (!reply) {
      console.error("[local-llm] empty reply");
      return null;
    }
    return trimForDiscord(reply);
  } catch (err) {
    const msg = err.name === "AbortError" ? "request timed out" : err.message;
    console.error("[local-llm] fetch error:", msg);
    reachable = false;
    return null;
  }
}

function getConfig() {
  return {
    enabled: isEnabled(),
    host: OLLAMA_HOST,
    model: OLLAMA_MODEL,
    reachable,
    localHost: isLocalOllamaHost(),
    misconfiguredOnRender: isMisconfiguredForRender(),
  };
}

module.exports = {
  chat,
  isEnabled,
  probe,
  getConfig,
  isLocalOllamaHost,
  isMisconfiguredForRender,
};
