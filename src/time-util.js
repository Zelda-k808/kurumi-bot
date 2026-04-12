/**
 * Local time parts for an IANA timezone (uses Intl; no extra deps).
 * @param {Date} date
 * @param {string} timeZone e.g. "America/New_York"
 */
function getPartsInZone(date, timeZone) {
  if (!timeZone || typeof timeZone !== "string") return null;
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const pick = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return {
      ymd: `${pick("year")}-${pick("month")}-${pick("day")}`,
      hour: parseInt(pick("hour"), 10),
      minute: parseInt(pick("minute"), 10),
      weekday: pick("weekday")
    };
  } catch {
    return null;
  }
}

/** Human-readable instant for embeds / chat. */
function formatDateTimeInZone(date, timeZone) {
  if (!timeZone || typeof timeZone !== "string") return date.toISOString();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

module.exports = { getPartsInZone, formatDateTimeInZone };
