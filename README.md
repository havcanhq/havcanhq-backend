# havcan-backend

Cloudflare Worker that powers **Kaamo**, HavCan's AI assistant, using Google Gemini **server-side**.
The browser never sees the Gemini key or the business prompt.

```
Browser (HavCan site on Cloudflare Pages, havcan-updated.html)
   │  POST https://havcan-backend.<your-subdomain>.workers.dev/api/kaamo   { "messages": [ {role, content}, ... ] }
   ▼
Worker: origin check → rate limit → validation → adds system instruction → Gemini → { "reply": "..." }
                                                         key: env.HAVCAN_KAAMO_GEMINI_KEY (Cloudflare Secret)
```

## The secret name (do not change it)

The Gemini key is read **only** from `env.HAVCAN_KAAMO_GEMINI_KEY`. It is a Cloudflare **Secret**, never written in
any file. A key stored under any other name (for example `GEMINI_API_KEY`) is ignored on purpose, and the Worker
answers `500 server_misconfigured` until `HAVCAN_KAAMO_GEMINI_KEY` exists.

## Project structure

```
havcan-backend/
├── wrangler.toml        Worker config, non-secret vars, rate-limit binding
├── package.json / package-lock.json   only devDependency: wrangler (no runtime dependencies)
├── .dev.vars.example    template for local secrets (copy to .dev.vars, git-ignored)
├── .gitignore
├── src/
│   ├── index.js         routing, CORS, errors, request flow
│   ├── config.js        reads env vars, limits
│   ├── cors.js          exact-match origin allow-list
│   ├── validate.js      body validation + history shaping
│   ├── ratelimit.js     Workers Rate Limiting binding + in-memory fallback
│   ├── gemini.js        server-side Gemini call, timeout, error mapping
│   ├── prompt.js        guardrails + system instruction assembly
│   └── knowledge.js     HavCan business knowledge (identical to the KMO_SYS text in the website)
├── test/                41 automated tests (node:test, Gemini mocked, no network)
└── scripts/
    ├── smoke-test.sh                    post-deploy checks against the live Worker
    ├── live-gemini-test.mjs             ONE real Gemini call (needs a real key; not part of `npm test`)
    └── frontend-integration-check.mjs   runs the website's Kaamo code against the Worker (mocked Gemini)
```

## API

`POST /api/kaamo` (Content-Type: application/json)

Request: `{ "messages": [ { "role": "user" | "assistant", "content": "text" }, ... ] }`
(last message must be from the user; newest 14 are used; extra fields are ignored.)

Success: `200 { "reply": "..." }`. The reply may contain the control tokens the page already understands
(`[[WA]]`, `[[NEGO]]`, `[[GO:services]]`, `[[CARD:poster]]` ...). An empty `reply` means Gemini returned nothing; the
website shows its own fallback.

Errors: `{ "error": { "code", "message" } }`

| Status | code | Meaning / what to do |
|---|---|---|
| 400 / 413 / 415 | `invalid_*`, `payload_too_large`, `message_too_long`, `unsupported_media_type` | bad request from the client |
| 403 | `origin_not_allowed` | the site's origin is not in `ALLOWED_ORIGINS` |
| 429 | `rate_limited` / `upstream_busy` | visitor rate limit / Gemini quota (`Retry-After` is set) |
| 500 | `server_misconfigured` | **`HAVCAN_KAAMO_GEMINI_KEY` secret is missing** on the Worker |
| 502 | `upstream_key_rejected` | Google rejected the key (invalid, restricted, API not enabled, billing) |
| 502 | `upstream_model_unavailable` | Google says the model id (`GEMINI_MODEL`) is not available to this key |
| 502 | `upstream_bad_request` / `upstream_rejected` | other Google 4xx; read the log |
| 502 / 504 | `upstream_error` / `upstream_timeout` | Google 5xx, network failure, or no answer within 20 s |

The response never contains Google's raw error text. That is written to the Worker log: run `npx wrangler tail` and
look for `gemini_error <kind> <google status> <google message>`. The Worker never retries with a different model and
never renames the key.

`GET /health` returns `{ ok, service, gemini_key_configured }`. `true` only means the secret exists, not that Google accepts it.

## Configuration

| Name | Where | Default | Purpose |
|---|---|---|---|
| `HAVCAN_KAAMO_GEMINI_KEY` | **Cloudflare Secret** | none | Gemini API key |
| `ALLOWED_ORIGINS` | `wrangler.toml` `[vars]` | placeholder | Comma-separated exact origins of the HavCan site |
| `GEMINI_MODEL` | `wrangler.toml` | `gemini-2.5-flash` | Model id |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SEC` | `wrangler.toml` | `10` / `60` | In-memory fallback limiter |
| `[[ratelimits]]` `RATE_LIMITER` | `wrangler.toml` | 10 per 60 s per IP | Cloudflare Rate Limiting binding (period must be 10 or 60) |
| `MAX_OUTPUT_TOKENS` | `wrangler.toml` | `600` | Max reply length |
| `SYSTEM_INSTRUCTION` | optional var | unset | Replaces the knowledge block only (max 5 KB). Server guardrails always stay. |

**Model note.** The selected model is `gemini-2.5-flash` and it has deliberately **not** been changed. Google's
deprecation page currently lists it with no shutdown date, but developers have reported `404 no longer available`
responses for it. If you see `upstream_model_unavailable`, that is the cause: pick a model from
<https://ai.google.dev/gemini-api/docs/models> yourself, set `GEMINI_MODEL` in `wrangler.toml`, commit and redeploy.
The `thinkingBudget: 0` setting is only sent for `2.5-flash` models, so other model ids work without edits.

**Business knowledge** lives in `src/knowledge.js`. If you change prices or services, change them in the website's
`KMO_SYS` text too (the website no longer sends it, it is kept for reference only).

---

## Deployment, step by step

You need: the HavCan site already on **Cloudflare Pages**, a GitHub account, a Gemini API key from Google AI Studio.

### 1. Set your site's origin(s)
Open `wrangler.toml` and replace the placeholder in `ALLOWED_ORIGINS` with the exact origin(s) your site is served from:
scheme + host, no path, no trailing slash, comma-separated, for example
`"https://havcan.com,https://www.havcan.com,https://havcan.pages.dev"`.
Add every address you actually open the site from. Pages *preview* deployments use different hostnames and are
not allowed unless you list them. While the placeholder is in place the Worker refuses every browser request (safe default).

### 2. Put the project on GitHub
Unzip `havcan-backend.zip`, make it a repository (or a folder inside your existing repo) and push to `main`.
`.gitignore` already excludes `node_modules`, `.dev.vars` and `.wrangler`. **Never commit a real key.**

### 3. Create the Worker from GitHub
Cloudflare dashboard → **Workers & Pages → Create application → Import a repository** → pick the repo.
- **Name: `havcan-backend`** (must equal `name` in `wrangler.toml`, or the build fails)
- **Root directory:** `/` (or the sub-folder name if it lives in a bigger repo)
- **Build command:** leave empty (or `npm ci`) · **Deploy command:** `npx wrangler deploy` · **Branch:** `main`
- Click **Save and Deploy**.

*(CLI alternative: `npm ci && npx wrangler login && npx wrangler deploy`.)*

### 4. Add the secret with the exact name `HAVCAN_KAAMO_GEMINI_KEY`
Worker → **Settings → Variables and Secrets → Add** → Type **Secret**, Name `HAVCAN_KAAMO_GEMINI_KEY`, value = your
Gemini key → **Deploy**. Do not use "Build variables and secrets" (those exist at build time only).
CLI alternative: `npx wrangler secret put HAVCAN_KAAMO_GEMINI_KEY`.

### 5. Note the Worker URL
The Worker page shows `https://havcan-backend.<your-subdomain>.workers.dev`. Your API endpoint is that URL plus `/api/kaamo`.

### 6. Connect the website (Cloudflare Pages)
In `havcan-updated.html` find this one line (around line 2550) and put your real endpoint in it:

```js
var KMO_API_URL='https://havcan-backend.YOUR-SUBDOMAIN.workers.dev/api/kaamo';
```

Rules: it must start with `https://`, end exactly with `/api/kaamo`, and have no trailing slash. While it still
contains `YOUR-SUBDOMAIN`, Kaamo stays in local-rules mode (no AI calls are attempted).
Rename the file to `index.html`, commit it to the repository that Pages deploys (or drag it into a Pages direct upload),
and let Pages redeploy.

### 7. Verify
```bash
bash scripts/smoke-test.sh https://havcan-backend.<your-subdomain>.workers.dev https://<your-site-origin>
```
Expect: health shows `"gemini_key_configured":true`, step 2 returns a `reply` mentioning Rs 499, step 3 `204`,
step 4 `403`, step 5 `400`. Then open the live site, ask Kaamo something its local rules don't cover
("what is SEO?"), and confirm an AI answer appears. If something fails, check the error `code` in the table above
and `npx wrangler tail`.

Optional real-key check from your own machine (does not deploy anything):
`HAVCAN_KAAMO_GEMINI_KEY=... npm run test:live`

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill HAVCAN_KAAMO_GEMINI_KEY, keep ALLOWED_ORIGINS for your local site origin
npm run dev                      # http://127.0.0.1:8787
npm test                         # 41 tests, mocked Gemini, no network needed
npm run check                    # wrangler dry-run: validates wrangler.toml and bundles the Worker
```

## Security notes (honest limits)

- The Origin check keeps *other websites* from using your endpoint from a browser. It is **not authentication**:
  a script can fake the header. The real protections are rate limiting and Google-side quotas.
- The Workers rate-limit binding is per IP **per Cloudflare location** and eventually consistent: it stops bursts, it is
  not an exact global quota. The in-memory fallback is per isolate. There is no database by design.
- Set a **quota / budget alert on the Gemini key** in Google AI Studio / Cloud Console as your hard cost ceiling.
- Visitors' messages are sent to Google. Keep your privacy policy accurate.
- Prompt injection can't be fully eliminated. The server rules tell the model to use only listed facts and hand
  unknowns to the team on WhatsApp, but treat Kaamo's answers as "can make mistakes".
