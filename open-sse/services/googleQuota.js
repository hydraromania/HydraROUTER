// Passive Google quota discovery from real 429 bodies (generativelanguage.googleapis.com).
// Google never sends "current RPD usage" — but a 429 carries the full violated limit:
// QuotaFailure.violations[] { quotaId, quotaMetric, quotaDimensions.model, quotaValue, subject? }
// + RetryInfo.retryDelay. Real data only: unknown stays null, never documented defaults.
// ponytail: single-violation (violations[0]). Upgrade path: merge all violations[] kinds.

/**
 * @param {string} bodyText raw upstream error body
 * @returns {{kind:'rpd'|'rpm'|'tpm'|null,model:string|null,limit:number|null,retryAfterSec:number|null,project:string|null,message:string}|null}
 */
export function parseGoogleQuotaError(bodyText) {
  if (!bodyText || typeof bodyText !== "string") return null;
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const err = json?.error;
  if (!err || typeof err !== "object") return null;
  const details = Array.isArray(err.details) ? err.details : [];
  const message = typeof err.message === "string" ? err.message : "";

  let retryAfterSec = null;
  for (const d of details) {
    const isRetry = d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" || (d && typeof d === "object" && d.retryDelay != null && d.violations == null);
    if (isRetry && d?.retryDelay) {
      const m = String(d.retryDelay).match(/([\d.]+)\s*s/i);
      if (m && Number.isFinite(Number(m[1]))) retryAfterSec = Math.ceil(Number(m[1]));
      break;
    }
  }
  if (retryAfterSec == null && message) {
    const m = message.match(/retr(?:y|ies).*?in\s+([\d.]+)\s*s/i);
    if (m && Number.isFinite(Number(m[1]))) retryAfterSec = Math.ceil(Number(m[1]));
  }

  let violation = null;
  for (const d of details) {
    const isQuota = d?.["@type"] === "type.googleapis.com/google.rpc.QuotaFailure" || (d && typeof d === "object" && Array.isArray(d?.violations));
    if (isQuota && d.violations.length > 0) {
      violation = d.violations[0];
      break;
    }
  }
  if (!violation) {
    // No structured quota info — still useful for real retry-after, but no limit discovery.
    if (retryAfterSec == null) return null;
    return { kind: null, model: null, limit: null, retryAfterSec, project: null, message: message.slice(0, 300) };
  }

  const hay = `${violation.quotaId || ""} ${violation.quotaMetric || ""}`;
  let kind = null;
  if (/token/i.test(hay)) kind = "tpm";
  else if (/perday/i.test(hay)) kind = "rpd";
  else if (/perminute/i.test(hay)) kind = "rpm";

  let limit = Number(violation.quotaValue);
  if (!Number.isFinite(limit)) {
    const m = message.match(/limit:\s*(\d[\d,]*)/i);
    limit = m ? Number(m[1].replace(/,/g, "")) : NaN;
  }
  if (!Number.isFinite(limit)) limit = null;

  return {
    kind,
    model: violation.quotaDimensions?.model || null,
    limit,
    retryAfterSec,
    // subject is optional in Violation schema — often absent; null = unknown, never invented.
    project: violation.subject ? String(violation.subject) : null,
    message: message.slice(0, 300),
  };
}
