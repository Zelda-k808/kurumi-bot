/** Resolve what the user is really asking (follow-ups, "look it up", etc.) */

const LOOKUP_RE =
  /\b(look\s*it\s*up|look\s*that\s*up|look\s*this\s*up|look\s*up|search\s+(it|that|this|for\s+me)|google\s+it|check\s+(it|that)|find\s+out|when\s+did\s+.+\s+start)\b/i;

const FOLLOWUP_RE =
  /\b(previous question|what i asked|what i ask|that question|the previous|yes for the previous|for the previous|what are you saying|what did i ask|answer that|about that)\b/i;

const META_MSG_RE =
  /^(kurumi\s+)?(yes|no|ok|okay|thanks|thank you|thx|look\s*it\s*up|look\s*up|hi|hey|hello|what are you saying|what\??)\s*$/i;

const FACTUAL_RE =
  /\b(what is|what are|how many|when did|is .+ free|patch|update|changes|operator|server|meaning of|tell me about|explain|look up|lookup)\b/i;

/** @param {Array<{content?: string, bot_reply?: string}>} recentChat newest-first */
function getPriorUserMessages(recentChat, max = 5) {
  const out = [];
  for (const row of recentChat || []) {
    const c = (row.content || "").trim();
    if (c.length < 6 || META_MSG_RE.test(c)) continue;
    if (LOOKUP_RE.test(c) && c.length < 40) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function needsPriorQuestion(text) {
  const t = String(text || "").trim();
  if (LOOKUP_RE.test(t)) return true;
  if (FOLLOWUP_RE.test(t)) return true;
  if (t.length < 50 && /\b(that|this|it)\b/i.test(t)) return true;
  return false;
}

function resolveQuery(currentMessage, recentChat) {
  const current = String(currentMessage || "").trim();
  if (!needsPriorQuestion(current)) return { query: current, isFollowUp: false };

  const prior = getPriorUserMessages(recentChat, 3);
  const resolved = prior[0] || current;
  return {
    query: resolved,
    isFollowUp: true,
    priorQuestions: prior,
  };
}

function buildConversationRecap(recentChat, maxTurns = 10) {
  const chronological = (recentChat || []).slice().reverse().slice(-maxTurns);
  const lines = [];
  for (const row of chronological) {
    if (row.content) {
      lines.push(`User: ${row.content.replace(/\s+/g, " ").slice(0, 280)}`);
    }
    if (row.bot_reply) {
      lines.push(`Kurumi: ${row.bot_reply.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  return lines.join("\n");
}

function isLikelyFactual(text) {
  return FACTUAL_RE.test(String(text || "")) || text.includes("?");
}

module.exports = {
  resolveQuery,
  buildConversationRecap,
  getPriorUserMessages,
  isLikelyFactual,
  needsPriorQuestion,
};
