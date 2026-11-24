// REAL Gemini call (not mocked). Needs a real key in the environment:
//   HAVCAN_KAAMO_GEMINI_KEY=... node scripts/live-gemini-test.mjs
// Optional: GEMINI_MODEL=... (defaults to the model in wrangler.toml). Prints the exact upstream problem if any.
import { readFileSync } from "node:fs";
import { handleRequest } from "../src/index.js";

const key = process.env.HAVCAN_KAAMO_GEMINI_KEY;
if (!key) { console.error("SKIPPED: HAVCAN_KAAMO_GEMINI_KEY is not set in the environment."); process.exit(2); }
const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const model = process.env.GEMINI_MODEL || (toml.match(/^GEMINI_MODEL\s*=\s*"([^"]+)"/m) || [])[1];
const ORIGIN = "https://live-test.example";
const env = { HAVCAN_KAAMO_GEMINI_KEY: key, GEMINI_MODEL: model, ALLOWED_ORIGINS: ORIGIN };

const res = await handleRequest(new Request("https://worker.test/api/kaamo", {
  method: "POST",
  headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.9" },
  body: JSON.stringify({ messages: [{ role: "user", content: "How much is a logo?" }] }),
}), env);
const body = await res.json();
console.log("model:", model, "| status:", res.status, "|", JSON.stringify(body).slice(0, 400));
if (res.status === 200 && body.reply && /499/.test(body.reply)) { console.log("PASS: real Gemini reply contains the Rs 499 logo price."); process.exit(0); }
if (res.status === 200) { console.log("WARN: 200 but reply is empty or lacks the expected price; inspect manually."); process.exit(1); }
console.error("FAIL. Error code above is specific: upstream_key_rejected = key invalid/restricted; upstream_model_unavailable = model id not served to this key; upstream_busy = quota/429. Run `npx wrangler tail` on the deployed Worker for Google's raw message.");
process.exit(1);
