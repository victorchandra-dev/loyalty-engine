#!/usr/bin/env bash
# Deterministic repro for the loyalty-engine 401 bug.
#
# Bug: The embedded app returns HTTP 401 when the Shopify Admin iframe follows up
# the document load with an XHR that carries an Authorization: Bearer <id_token>
# header. The token fails validation inside
# `@shopify/shopify-app-react-router`'s `validateSessionToken`, which calls
# `respondToInvalidSessionToken`. Because the request carries an Authorization
# header (i.e. is NOT a document request), the helper throws
# `new Response(undefined, {status: 401, headers: RETRY_INVALID_SESSION_HEADER})`
# instead of redirecting to the bounce page. The response includes the
# `x-shopify-retry-invalid-session-request: 1` header.
#
# This script sends a forged `Authorization: Bearer <jwt>` request that mimics
# what App Bridge sends once the document has loaded. JWT decoding fails either
# because the signature does not match `SHOPIFY_API_SECRET` OR because the
# audience does not match `SHOPIFY_API_KEY`.
#
# Exits 0 if the 401 is observed (repro confirmed).
# Exits 1 otherwise.
#
# Usage:
#   APP_URL=https://amadaflow-loyalty-201907146826.asia-southeast1.run.app \
#     bash scripts/repro-401.sh
#
# Or, against a local dev server:
#   APP_URL=http://localhost:3000 bash scripts/repro-401.sh
#
# Environment:
#   APP_URL - base URL of the deployed/running loyalty-engine (required)
#   SHOP    - shop domain, default adf-internal.myshopify.com
#   HOST    - base64 host param, default is adf-internal
set -euo pipefail

APP_URL="${APP_URL:-https://amadaflow-loyalty-201907146826.asia-southeast1.run.app}"
SHOP="${SHOP:-adf-internal.myshopify.com}"
HOST="${HOST:-YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvYWRmLWludGVybmFs}"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

# Forge a structurally-valid JWT with a wrong audience / wrong signing secret.
# This is guaranteed to fail `decodeSessionToken` regardless of the deployed
# SHOPIFY_API_KEY / SHOPIFY_API_SECRET.
NOW=$(date +%s)
EXP=$((NOW + 3600))
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER_B64=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
PAYLOAD_B64=$(printf '{"iss":"https://%s/admin","dest":"https://%s","aud":"WRONG_API_KEY","sub":"1","exp":%d,"nbf":%d,"iat":%d,"jti":"abc","sid":"def"}' \
  "$SHOP" "$SHOP" "$EXP" "$NOW" "$NOW" | b64url)
SIG_B64=$(printf '%s.%s' "$HEADER_B64" "$PAYLOAD_B64" \
  | openssl dgst -sha256 -hmac 'wrong_secret' -binary | b64url)
JWT="${HEADER_B64}.${PAYLOAD_B64}.${SIG_B64}"

URL="${APP_URL}/app?shop=${SHOP}&host=${HOST}&embedded=1"

echo "Requesting: GET ${URL}"
echo "Authorization: Bearer <forged-jwt>"
echo

STATUS=$(curl -s -o /tmp/repro-401.body -D /tmp/repro-401.hdrs \
  --max-time 15 \
  -H "User-Agent: ${UA}" \
  -H "Authorization: Bearer ${JWT}" \
  -w '%{http_code}' \
  "$URL")

echo "Response status: $STATUS"
echo "---"
echo "Response headers:"
cat /tmp/repro-401.hdrs
echo "---"

if [ "$STATUS" = "401" ] && grep -iq '^x-shopify-retry-invalid-session-request: 1' /tmp/repro-401.hdrs; then
  echo "REPRO CONFIRMED: got HTTP 401 + x-shopify-retry-invalid-session-request: 1"
  echo "Origin: node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/helpers/respond-to-invalid-session-token.mjs:10-14"
  exit 0
fi

echo "REPRO FAILED: expected 401 with x-shopify-retry-invalid-session-request header, got $STATUS"
exit 1
