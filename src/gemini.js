// Server-side call to the Gemini generateContent REST endpoint.
// The API key is sent in a header (never in the URL) and never leaves this file's caller.

export class GeminiError extends Error {
  constructor(kind, upstreamStatus, detail) {
    super(kind);
    this.kind = kind; // 'timeout' | 'network' | 'rate_limited' | 'config' | 'upstream'
    this.upstreamStatus = upstreamStatus || 0;
    this.detail = detail || "";
  }
}

export async function callGemini(opts, fetchImpl = fetch) {
  const { apiKey, model, systemInstruction, contents, maxOutputTokens, temperature, timeoutMs } = opts;

  const generationConfig = { temperature, maxOutputTokens };
  // Same behaviour as the old browser code: no "thinking" for the fast 2.5 Flash models.
  if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") throw new GeminiError("timeout");
    throw new GeminiError("network", 0, String(err && err.message ? err.message : err));
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (payload && payload.error && payload.error.message) || "";
    if (res.status === 429) throw new GeminiError("rate_limited", res.status, detail);
    if (res.status >= 400 && res.status < 500) throw new GeminiError("config", res.status, detail);
    throw new GeminiError("upstream", res.status, detail);
  }

  const cand = payload && payload.candidates && payload.candidates[0];
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("").trim();
  // Empty text means the answer was blocked or empty; the caller returns an empty reply
  // and the frontend shows its own safe fallback.
  return { text, finishReason: (cand && cand.finishReason) || null };
}
