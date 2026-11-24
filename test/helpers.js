import { resetMemoryLimiter } from "../src/ratelimit.js";

export const ORIGIN = "https://havcan.example";

export function makeEnv(extra = {}) {
  return {
    HAVCAN_KAAMO_GEMINI_KEY: "test-key-not-real",
    ALLOWED_ORIGINS: `${ORIGIN},https://www.havcan.example/`,
    GEMINI_MODEL: "gemini-2.5-flash",
    ...extra,
  };
}

export function req(body, { method = "POST", origin = ORIGIN, headers = {}, raw, path = "/api/kaamo", ip = "1.2.3.4" } = {}) {
  const h = { "CF-Connecting-IP": ip, ...headers };
  if (origin) h.Origin = origin;
  const init = { method, headers: h };
  if (method !== "GET" && method !== "OPTIONS" && method !== "HEAD") {
    if (!("Content-Type" in h)) h["Content-Type"] = "application/json";
    init.body = raw !== undefined ? raw : JSON.stringify(body);
  }
  return new Request("https://worker.test" + path, init);
}

// Fake Gemini: records the call, returns a canned reply.
export function fakeGemini(reply = "Hi! I'm Kaamo.", { status = 200, throwErr = null, hang = false, payload } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (hang) {
      return new Promise((_, rej) => {
        init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
      });
    }
    if (throwErr) throw throwErr;
    const p = payload !== undefined ? payload : { candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }] };
    return new Response(JSON.stringify(p), { status, headers: { "Content-Type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

export function reset() {
  resetMemoryLimiter();
}
