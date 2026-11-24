// Static guard: no real-looking API key anywhere in the backend source, and the secret name is exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".wrangler", ".git"]);
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const files = walk(root).filter((f) => !f.endsWith(".zip"));

test("no Google API key pattern (AIza...) in any project file", () => {
  for (const f of files) assert.ok(!/AIza[0-9A-Za-z_\-]{30,}/.test(readFileSync(f, "utf8")), `key-like string in ${f}`);
});

test(".dev.vars is git-ignored and the example has an empty key", () => {
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^\.dev\.vars$/m);
  assert.match(readFileSync(join(root, ".dev.vars.example"), "utf8"), /^HAVCAN_KAAMO_GEMINI_KEY=\s*$/m);
});

test("old secret name GEMINI_API_KEY is not used anywhere in code or config", () => {
  for (const f of files.filter((f) => !f.endsWith("secrets.test.js") && !f.endsWith("kaamo.test.js") && !f.endsWith(".md"))) {
    assert.ok(!/(?<!HAVCAN_KAAMO_)GEMINI_API_KEY/.test(readFileSync(f, "utf8")), `old name in ${f}`);
  }
});

test("worker reads exactly env.HAVCAN_KAAMO_GEMINI_KEY", () => {
  assert.match(readFileSync(join(root, "src/index.js"), "utf8"), /env\.HAVCAN_KAAMO_GEMINI_KEY/);
});
