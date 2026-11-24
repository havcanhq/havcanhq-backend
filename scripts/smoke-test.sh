#!/usr/bin/env bash
# Post-deploy smoke test against the DEPLOYED Worker.
# Usage: scripts/smoke-test.sh https://havcan-backend.<subdomain>.workers.dev https://your-site-origin
set -u
URL="${1:?worker base url}"; SITE="${2:?allowed site origin}"
J='Content-Type: application/json'
echo "1) health";            curl -s "$URL/health"; echo
echo "2) real answer";       curl -s -X POST "$URL/api/kaamo" -H "Origin: $SITE" -H "$J" -d '{"messages":[{"role":"user","content":"How much is a logo?"}]}'; echo
echo "3) preflight (204)";   curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS "$URL/api/kaamo" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
echo "4) bad origin (403)";  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/api/kaamo" -H "Origin: https://evil.example" -H "$J" -d '{"messages":[{"role":"user","content":"hi"}]}'
echo "5) bad body (400)";    curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/api/kaamo" -H "Origin: $SITE" -H "$J" -d '{}'
