import { getConfig } from "./config.js";
import { corsHeaders, isAllowedOrigin } from "./cors.js";
import { validateBody } from "./validate.js";
import { checkRateLimit } from "./ratelimit.js";
import { buildSystemInstruction } from "./prompt.js";
import { callGemini, GeminiError } from "./gemini.js";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

function errorResponse(status, code, message, extra = {}) {
  return json(status, { error: { code, message } }, extra);
}

// Reads the body but refuses to buffer more than `max` bytes (even without Content-Length).
async function readBodyLimited(request, max) {
  const declared = Number.parseInt(request.headers.get("Content-Length") || "", 10);
  if (Number.isFinite(declared) && declared > max) return { tooLarge: true };
  if (!request.body) return { text: "" };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder().decode(buf) };
}

export async function handleRequest(request, env, deps = {}) {
  const cfg = getConfig(env);
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, cfg);

  if (url.pathname === "/health" && request.method === "GET") {
    return json(200, { ok: true, service: "havcan-backend", gemini_key_configured: Boolean(env.HAVCAN_KAAMO_GEMINI_KEY) });
  }

  if (url.pathname !== "/api/kaamo") {
    return errorResponse(404, "not_found", "Not found.");
  }

  // CORS preflight
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin, cfg.allowedOrigins)) {
      return errorResponse(403, "origin_not_allowed", "Origin not allowed.");
    }
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }

  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST.", { Allow: "POST, OPTIONS", ...cors });
  }

  // Browsers always send Origin on cross-origin POSTs. Not authentication (non-browser
  // clients can fake it) but it keeps other websites from using this endpoint.
  if (!isAllowedOrigin(origin, cfg.allowedOrigins)) {
    return errorResponse(403, "origin_not_allowed", "Origin not allowed.");
  }

  const rl = await checkRateLimit(request, env, cfg, deps.now);
  if (!rl.ok) {
    return errorResponse(429, "rate_limited", "Too many requests. Please wait a moment.", {
      "Retry-After": String(rl.retryAfter),
      ...cors,
    });
  }

  const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ctype.startsWith("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Content-Type must be application/json.", cors);
  }

  const body = await readBodyLimited(request, cfg.maxBodyBytes);
  if (body.tooLarge) return errorResponse(413, "payload_too_large", "Request body too large.", cors);

  let parsed;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return errorResponse(400, "invalid_json", "Body is not valid JSON.", cors);
  }

  const v = validateBody(parsed, cfg);
  if (!v.ok) return errorResponse(v.status, v.code, v.message, cors);

  if (!env.HAVCAN_KAAMO_GEMINI_KEY) {
    console.error("HAVCAN_KAAMO_GEMINI_KEY is not set (add it with: npx wrangler secret put HAVCAN_KAAMO_GEMINI_KEY)");
    return errorResponse(500, "server_misconfigured", "The assistant is not configured yet.", cors);
  }

  try {
    const result = await callGemini(
      {
        apiKey: env.HAVCAN_KAAMO_GEMINI_KEY,
        model: cfg.model,
        systemInstruction: buildSystemInstruction(env),
        contents: v.contents,
        maxOutputTokens: cfg.maxOutputTokens,
        temperature: cfg.temperature,
        timeoutMs: cfg.timeoutMs,
      },
      deps.fetchImpl || fetch
    );
    return json(200, { reply: result.text }, cors);
  } catch (err) {
    const kind = err instanceof GeminiError ? err.kind : "internal";
    // Log the cause server-side only (never the visitor's text, never the key).
    console.error("gemini_error", kind, err.upstreamStatus || "", err.detail || "");
    if (kind === "rate_limited") return errorResponse(429, "upstream_busy", "The assistant is busy. Try again shortly.", { "Retry-After": "10", ...cors });
    if (kind === "timeout") return errorResponse(504, "upstream_timeout", "The assistant took too long to answer.", cors);
    if (kind === "config") {
      // Specific machine-readable code so the exact problem can be diagnosed from the response
      // (messages stay generic; Google's raw error text is only written to the Worker logs).
      const st = err.upstreamStatus;
      const d = String(err.detail || "").toLowerCase();
      let code = "upstream_rejected";
      if (st === 404 || /model/.test(d) && /not found|no longer available|not supported/.test(d)) code = "upstream_model_unavailable";
      else if (st === 401 || st === 403 || /api key|permission|unauthenticated/.test(d)) code = "upstream_key_rejected";
      else if (st === 400) code = "upstream_bad_request";
      return errorResponse(502, code, "The assistant is temporarily unavailable.", cors);
    }
    return errorResponse(502, "upstream_error", "The assistant is temporarily unavailable.", cors);
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("unhandled_error", String(err && err.message ? err.message : err));
      return errorResponse(500, "internal_error", "Something went wrong.");
    }
  },
};
