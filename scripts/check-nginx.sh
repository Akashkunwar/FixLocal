#!/usr/bin/env bash
# Runs frontend/nginx.conf against a stub API and checks the behaviour we rely on:
# pro-page meta tags (and the fallback head when the API errors or is down), gzip, security headers,
# real 404s for missing static files. Needs nginx and node. Usage: scripts/check-nginx.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NGINX=$(command -v nginx || echo /usr/sbin/nginx)
WEB_PORT=${CHECK_NGINX_PORT:-47810}
API_PORT=$((WEB_PORT + 1))
T=$(mktemp -d)
trap '"$NGINX" -c "$T/nginx.conf" -p "$T" -s stop 2>/dev/null || true; [ -n "${STUB:-}" ] && kill "$STUB" 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p "$T/html/assets" "$T/logs"
cp "$ROOT/frontend/security-headers.conf" "$T/"
sed -e '/resolver 127.0.0.11/d' -e "s#http://api:3001#http://127.0.0.1:$API_PORT#" -e "s#listen 80;#listen $WEB_PORT;#" \
  -e "s#/usr/share/nginx/html#$T/html#" -e "s#/etc/nginx/security-headers.conf#$T/security-headers.conf#" \
  "$ROOT/frontend/nginx.conf" > "$T/site.conf"
cat > "$T/nginx.conf" <<EOF
pid $T/nginx.pid;
error_log $T/logs/error.log;
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path $T/cb; proxy_temp_path $T/pt; fastcgi_temp_path $T/ft; uwsgi_temp_path $T/ut; scgi_temp_path $T/st;
  include $T/site.conf;
}
EOF
INCLUDE=$(sed -n "s/^export const PRO_HEAD_INCLUDE = '\(.*\)';$/\1/p" "$ROOT/frontend/src/lib/seo.ts")
printf '<html><head>\n%s\n</head><body><div id="root"></div></body></html>' "$INCLUDE" > "$T/html/pro.html"
echo shell > "$T/html/index.html"
head -c 5000 /dev/zero | tr '\0' a > "$T/html/assets/app.js"
cat > "$T/stub.js" <<EOF
let mode = "ok";
require("http").createServer((q, s) => {
  if (q.url.startsWith("/mode/")) { mode = q.url.slice(6); return s.end(); }
  if (q.url.startsWith("/api/seo/pros/")) {
    if (mode === "429") { s.writeHead(429, { "content-type": "application/json" }); return s.end('{"code":"RATE_LIMITED"}'); }
    if (mode === "500") { s.writeHead(500); return s.end("<title>500</title>"); }
    return s.end("<title>Ravi the plumber</title>");
  }
  if (q.url === "/api/seo/sitemap-pros.xml") return s.end("<urlset/>");
  s.end("api " + q.url);
}).listen($API_PORT, "127.0.0.1");
EOF
node "$T/stub.js" & STUB=$!
"$NGINX" -t -q -c "$T/nginx.conf" -p "$T"
"$NGINX" -c "$T/nginx.conf" -p "$T"
sleep 0.5
W="http://127.0.0.1:$WEB_PORT"
PRO="$W/pros/11111111-2222-4333-8444-555555555555"
fail() { echo "FAIL: $1"; exit 1; }
curl -s "$PRO" | grep -q "<title>Ravi the plumber</title>" || fail "pro head not inlined"
curl -s "http://127.0.0.1:$API_PORT/mode/429" >/dev/null
curl -s "$PRO" | grep -q "<title>Professional on FixLocal</title>" || fail "429 not replaced by the default head"
curl -s "$PRO" | grep -q RATE_LIMITED && fail "API error body leaked into the page"
curl -s "http://127.0.0.1:$API_PORT/mode/500" >/dev/null
curl -s "$PRO" | grep -q "<title>Professional on FixLocal</title>" || fail "500 not replaced by the default head"
[ "$(curl -s "$W/sitemap-pros.xml")" = "<urlset/>" ] || fail "sitemap-pros.xml"
[ "$(curl -s "$W/api/jobs?x=1")" = "api /api/jobs?x=1" ] || fail "api proxy"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$W/missing.js")" = 404 ] || fail "missing static file is not a 404"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$W/_seo/default-head")" = 404 ] || fail "internal location reachable"
[ "$(curl -s "$W/client/jobs")" = shell ] || fail "app shell fallback"
H=$(curl -s -D - -o /dev/null -H "Accept-Encoding: gzip" "$W/assets/app.js")
grep -qi "content-encoding: gzip" <<<"$H" || fail "gzip"
grep -qi "x-content-type-options: nosniff" <<<"$H" || fail "nosniff on assets"
grep -qi "strict-transport-security" <<<"$H" || fail "HSTS"
kill $STUB; STUB=
sleep 0.2
curl -s "$PRO" | grep -q "<title>Professional on FixLocal</title>" || fail "API down not replaced by the default head"
echo "nginx checks passed"
