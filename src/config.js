// Reads runtime configuration from the Worker `env`.
// Non-secret values live in wrangler.toml [vars]; the Gemini key is a Cloudflare Secret.

function int(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
}

export function getConfig(env) {
  return {
    model: (env.GEMINI_MODEL || "gemini-2.5-flash").trim(),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),

    // In-isolate fallback limiter (used when the RATE_LIMITER binding is absent).
    rateMax: int(env.RATE_LIMIT_MAX, 10, 1, 1000),
    rateWindowSec: int(env.RATE_LIMIT_WINDOW_SEC, 60, 1, 3600),

    // Request limits.
    maxBodyBytes: 64 * 1024,
    maxMessagesAccepted: 40, // more than this => 400
    historyKept: 14, // newest N messages are forwarded to Gemini (same as the old client code)
    maxMessageChars: 4000,
    maxLastUserChars: 2000,

    // Gemini call.
    maxOutputTokens: int(env.MAX_OUTPUT_TOKENS, 600, 50, 2048),
    temperature: 0.6,
    timeoutMs: 20000,
  };
}
