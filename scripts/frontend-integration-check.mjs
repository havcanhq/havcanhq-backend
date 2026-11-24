import { readFileSync } from "node:fs";
// Runs the REAL Kaamo functions from the frontend HTML against the REAL Worker handler (Gemini mocked).
// Usage: node scripts/frontend-integration-check.mjs path/to/havcan-updated.html
import { argv } from "node:process";
const htmlPath = argv[2]; if (!htmlPath) { console.error("usage: node scripts/frontend-integration-check.mjs <html file>"); process.exit(2); }
function extract() { const h = readFileSync(htmlPath, "utf8"); const a = h.indexOf("function kmoHistory"), b = h.indexOf("function kmoLocalAsync"); if (a < 0 || b < 0) throw new Error("Kaamo functions not found in HTML"); return h.slice(a, b); }
import { handleRequest } from "../src/index.js";
const SITE="https://havcan.example";
const URL_="https://havcan-backend.test.workers.dev/api/kaamo";
let seen=null;
const fakeGoogle=async(u,init)=>{seen=JSON.parse(init.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Logo Design is Rs 499. **Great** choice! [[CARD:logo]]"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}})};
// browser fetch -> Worker (same wire format the browser would send)
globalThis.fetch=async(u,init)=>{
  const hdr=new Headers(init.headers); hdr.set("Origin",SITE); hdr.set("CF-Connecting-IP","5.5.5.5");
  return handleRequest(new Request(u,{...init,headers:hdr}),{HAVCAN_KAAMO_GEMINI_KEY:"k",ALLOWED_ORIGINS:SITE},{fetchImpl:fakeGoogle});
};
const S={msgs:[{role:"user",content:"how much is a logo?"}]};
const KMO_API_URL=URL_,KMO_FALLBACK={en:"fallback"},KMO_GO={services:1},KMO_CT={logo:1},KMO_ALLW=[],KMO_NAVV=/x/,KMO_NEGO_MSG="n";
const kmoNorm=x=>x;
const src=extract();
const {kmoGemini}=new Function("S","KMO_API_URL","KMO_FALLBACK","KMO_GO","KMO_CT","KMO_ALLW","KMO_NAVV","KMO_NEGO_MSG","kmoNorm",src+";return {kmoGemini,kmoHistory}")(S,KMO_API_URL,KMO_FALLBACK,KMO_GO,KMO_CT,KMO_ALLW,KMO_NAVV,KMO_NEGO_MSG,kmoNorm);
const out=await kmoGemini(new AbortController().signal);
console.log("frontend parsed:",JSON.stringify(out));
console.log("Gemini got contents:",JSON.stringify(seen.contents));
console.log("systemInstruction set server-side:",seen.systemInstruction.parts[0].text.includes("Aditya Kumar Roy"));
const ok=out.reply==="Logo Design is Rs 499. Great choice!"&&JSON.stringify(out.cards)==='["logo"]'&&seen.contents[0].role==="user";
console.log(ok?"INTEGRATION PASS":"INTEGRATION FAIL"); process.exit(ok?0:1);
