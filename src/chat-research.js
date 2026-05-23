const gaming = require("./gaming-knowledge");
const chatContext = require("./chat-context");

const RESEARCH_TIMEOUT = 12_000;

async function fetchWithTimeout(url, options = {}, ms = RESEARCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function duckDuckGoAbstract(query) {
  const q = encodeURIComponent(query.slice(0, 200));
  const url = `https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&skip_disambig=1`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const parts = [];
    if (data.AbstractText) {
      parts.push(`${data.AbstractText}${data.AbstractURL ? ` (source: ${data.AbstractURL})` : ""}`);
    }
    if (data.Answer) parts.push(String(data.Answer));
    for (const t of (data.RelatedTopics || []).slice(0, 4)) {
      if (t.Text) parts.push(t.Text);
      else if (t.Topics) {
        for (const sub of t.Topics.slice(0, 2)) {
          if (sub.Text) parts.push(sub.Text);
        }
      }
    }
    if (!parts.length) return null;
    return `Web summary (DuckDuckGo) for "${query}":\n${parts.join("\n")}`.slice(0, 1800);
  } catch (_) {
    return null;
  }
}

async function wikipediaSearch(query) {
  const q = encodeURIComponent(query.slice(0, 120));
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&origin=*&srlimit=2`;
    const sRes = await fetchWithTimeout(searchUrl);
    if (!sRes.ok) return null;
    const sData = await sRes.json();
    const title = sData.query?.search?.[0]?.title;
    if (!title) return null;

    const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const sumRes = await fetchWithTimeout(sumUrl);
    if (!sumRes.ok) return null;
    const sum = await sumRes.json();
    const extract = sum.extract || sum.description;
    if (!extract) return null;
    return `Wikipedia (${title}): ${extract}`.slice(0, 1200);
  } catch (_) {
    return null;
  }
}

/**
 * Gather reference material for the LLM (may take a few seconds).
 * @param {string} query
 * @param {{ force?: boolean }} opts
 */
async function gatherFacts(query, opts = {}) {
  const q = String(query || "").trim();
  if (!q || q.length < 4) return null;

  const force = opts.force || chatContext.isLikelyFactual(q);
  const chunks = [];

  const gamingCtx = await gaming.buildContext(q, { forceLookup: force });
  if (gamingCtx) chunks.push(gamingCtx);

  if (force || !gamingCtx) {
    const [wiki, ddg] = await Promise.all([wikipediaSearch(q), duckDuckGoAbstract(q)]);
    if (wiki) chunks.push(wiki);
    if (ddg) chunks.push(ddg);
  }

  if (!chunks.length) return null;

  return (
    "FACTS FROM LOOKUP (use these; do NOT invent patch notes, abilities, or game mechanics not listed here):\n" +
    chunks.join("\n\n---\n")
  ).slice(0, 3500);
}

module.exports = { gatherFacts, duckDuckGoAbstract, wikipediaSearch };
