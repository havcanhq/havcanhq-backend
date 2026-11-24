import { test } from "node:test";
import assert from "node:assert/strict";
import { callGemini, GeminiError } from "../src/gemini.js";
import { fakeGemini } from "./helpers.js";

const base = { apiKey: "k", model: "gemini-2.5-flash", systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }], maxOutputTokens: 600, temperature: 0.6 };

test("timeout aborts and throws GeminiError('timeout')", async () => {
  await assert.rejects(callGemini({ ...base, timeoutMs: 30 }, fakeGemini("", { hang: true })), (e) => e instanceof GeminiError && e.kind === "timeout");
});

test("thinkingConfig only for 2.5-flash family", async () => {
  const f1 = fakeGemini(); await callGemini({ ...base, timeoutMs: 1000 }, f1);
  assert.ok(f1.calls[0].body.generationConfig.thinkingConfig);
  const f2 = fakeGemini(); await callGemini({ ...base, model: "gemini-3.5-flash-lite", timeoutMs: 1000 }, f2);
  assert.equal(f2.calls[0].body.generationConfig.thinkingConfig, undefined);
});

test("joins multi-part text", async () => {
  const f = fakeGemini("", { payload: { candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] } });
  assert.equal((await callGemini({ ...base, timeoutMs: 1000 }, f)).text, "ab");
});
