// Basic rate limiting, no database.
//
// 1) Preferred: the Cloudflare Workers Rate Limiting binding `RATE_LIMITER`
//    (configured in wrangler.toml). It is counted per client IP, per Cloudflare location,
//    and is intentionally permissive/eventually consistent: it stops bursts and abuse,
//    it is not an exact global counter.
// 2) Fallback: a small sliding window kept in this isolate's memory. It resets when the
//    isolate is recycled and is not shared between isolates/locations, so treat it as a
//    safety net (and what makes local dev + tests work), not as the main protection.

const memory = new Map(); // ip -> array of request timestamps (ms)
const MAX_TRACKED_IPS = 5000;

export function resetMemoryLimiter() {
  memory.clear();
}

function memoryLimit(ip, cfg, now) {
  const windowMs = cfg.rateWindowSec * 1000;
  const cutoff = now - windowMs;

  if (memory.size > MAX_TRACKED_IPS) {
    for (const [k, v] of memory) {
      if (!v.length || v[v.length - 1] <= cutoff) memory.delete(k);
    }
    if (memory.size > MAX_TRACKED_IPS) memory.clear(); // last resort: bound memory
  }

  const hits = (memory.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= cfg.rateMax) {
    memory.set(ip, hits);
    const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }
  hits.push(now);
  memory.set(ip, hits);
  return { ok: true };
}

export async function checkRateLimit(request, env, cfg, now = Date.now()) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      return success ? { ok: true } : { ok: false, retryAfter: cfg.rateWindowSec };
    } catch (err) {
      console.error("rate_limiter_binding_error", String(err && err.message ? err.message : err));
      // fall through to the in-memory limiter
    }
  }
  return memoryLimit(ip, cfg, now);
}
