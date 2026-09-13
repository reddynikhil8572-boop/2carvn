#!/usr/bin/env bash
#
# Asserts that authentication actually works over TLS, with the cookie flags
# production uses — and that it does NOT work without TLS.
#
#   docker compose up -d && npm run seed && bash scripts/tls-check.sh
#
# The second half is the point. `Secure; SameSite=None` cookies are discarded
# by any correct client over plain HTTP, so login returns 200 and every
# subsequent request 401s, with nothing in the logs to explain it. That is the
# first failure listed in RUNBOOK.md §1. A check that only proved the happy
# path over HTTPS would pass just as well against an API that ignored the flags
# entirely.
#
# Requires: the compose stack running in production mode, openssl, node.
set -u

API_PORT=${API_PORT:-5000}
TLS_PORT=${TLS_PORT:-8443}

# NOT localhost, and this is the crux of section 4.
#
# RFC 6265bis lets a client treat "potentially trustworthy" origins as secure
# even over plain http, and localhost and 127.0.0.1 are exactly that — both
# browsers and curl will send a `Secure` cookie to http://localhost quite
# happily. The first version of this script used localhost, and section 4
# failed with three 200s that looked like the API ignoring its own cookie
# flags. It was the harness: on localhost there is no such thing as an insecure
# request, so the negative control could never have held.
#
# The checks therefore run against a name with no special standing, mapped to
# the loopback address by curl rather than by DNS or the hosts file.
HOST=${HOST_UNDER_TEST:-edusphere.test}
OWNER_EMAIL=${OWNER_EMAIL:-owner@edusphere.local}
OWNER_PASSWORD=${OWNER_PASSWORD:-ChangeMe!2026}

PASS=0
FAIL=0
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() {
  if [ "$2" = "$3" ]; then printf '  PASS  %-54s %s\n' "$1" "$2"; PASS=$((PASS + 1));
  else printf '  FAIL  %-54s got %s want %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); fi
}
has() {
  if printf '%s' "$2" | grep -qi -- "$3"; then printf '  PASS  %-54s %s\n' "$1" "$3"; PASS=$((PASS + 1));
  else printf '  FAIL  %-54s missing %s\n' "$1" "$3"; FAIL=$((FAIL + 1)); fi
}

WORK=$(mktemp -d)

# openssl, node and curl here are native Windows builds under Git Bash, and
# none of them can resolve an MSYS path like /tmp/tmp.XXXX — they report the
# file as missing, which reads as "openssl is broken" rather than "wrong path
# spelling". Everything handed to those three uses $W; only the shell's own rm
# uses $WORK. On Linux and macOS cygpath is absent and the two are identical.
W=$WORK
command -v cygpath >/dev/null 2>&1 && W=$(cygpath -m "$WORK")

RESOLVE="--resolve $HOST:$TLS_PORT:127.0.0.1 --resolve $HOST:$API_PORT:127.0.0.1"

PROXY_PID=""
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── A certificate ───────────────────────────────────────────────────────────
#
# Self-signed and short-lived. curl is pointed at it with --cacert rather than
# -k: skipping verification would also skip the hostname check, and a proxy
# serving a certificate for the wrong host is a thing worth failing on.
say "0. Generating a self-signed certificate"
# Its own openssl.cnf, rather than whatever OPENSSL_CONF happens to point at.
# On the machine this was written on that variable pointed into a PostgreSQL
# ODBC install that does not exist, and every `openssl req` failed with a
# missing-file error nowhere near the actual cause. `openssl enc` needs no
# config, so backup.sh worked fine and hid it.
cat > "$W/openssl.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $HOST
CNF

OPENSSL_CONF="$W/openssl.cnf" \
  openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes \
  -config "$W/openssl.cnf" \
  -keyout "$W/key.pem" -out "$W/cert.pem" \
  -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1" 2>/dev/null
[ -s "$W/cert.pem" ] && echo "  ok    certificate for CN=$HOST" || { echo "  FATAL: openssl failed"; exit 1; }

node "$(dirname "$0")/tls-proxy.js" "$W/cert.pem" "$W/key.pem" "$TLS_PORT" "$API_PORT" &
PROXY_PID=$!

for _ in $(seq 1 30); do
  curl -sf --cacert "$W/cert.pem" $RESOLVE "https://$HOST:$TLS_PORT/health" >/dev/null 2>&1 && break
  sleep 1
done

HTTPS="https://$HOST:$TLS_PORT/api/v1"
PLAIN="http://$HOST:$API_PORT/api/v1"
CURL="curl -s --cacert $W/cert.pem $RESOLVE"
jar="$W/jar.txt"

say "1. The proxy is really serving TLS, verified against the certificate"
c=$($CURL -o /dev/null -w '%{http_code}' "https://$HOST:$TLS_PORT/health")
ok "GET /health over https" "$c" "200"
proto=$($CURL -o /dev/null -w '%{scheme}/%{ssl_verify_result}' "https://$HOST:$TLS_PORT/health")
ok "scheme and certificate verification" "$proto" "https/0"

say "2. Login over HTTPS sets production cookie flags"
c=$($CURL -c "$jar" -D "$W/headers.txt" -o "$W/body.json" -w '%{http_code}' \
  -X POST "$HTTPS/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}")
ok "super admin login over https" "$c" "200"

setcookie=$(grep -i '^set-cookie:' "$W/headers.txt" || true)
access=$(printf '%s\n' "$setcookie" | grep -i 'edusphere_at' || true)
refresh=$(printf '%s\n' "$setcookie" | grep -i 'edusphere_rt' || true)

# Asserted per cookie, not across the whole header block: a single `Secure`
# anywhere in the response would otherwise satisfy a naive grep while the
# refresh cookie — the long-lived one — went out unprotected.
if [ -z "$access" ] || [ -z "$refresh" ]; then
  printf '  FAIL  %-54s no session cookies in the response\n' "cookies present"
  FAIL=$((FAIL + 1))
else
  printf '  PASS  %-54s edusphere_at, edusphere_rt\n' "cookies present"
  PASS=$((PASS + 1))
  for pair in "access:$access" "refresh:$refresh"; do
    name=${pair%%:*}
    value=${pair#*:}
    has "$name cookie is Secure" "$value" "Secure"
    has "$name cookie is HttpOnly" "$value" "HttpOnly"
    has "$name cookie is SameSite=None" "$value" "SameSite=None"
  done
fi

say "3. The session survives a second request — the reload test"
c=$($CURL -b "$jar" -c "$jar" -o "$W/me.json" -w '%{http_code}' "$HTTPS/auth/me")
ok "GET /auth/me over https with the jar" "$c" "200"
email=$(node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try { process.stdout.write(String(JSON.parse(raw).data.email)); } catch { process.stdout.write(""); }
  });' < "$W/me.json")
ok "and returns the signed-in identity" "$email" "$OWNER_EMAIL"

say "4. Without TLS the very same cookies are useless"
# curl will not send a Secure cookie over http, which is precisely what a
# browser does. This is the runbook's "login works but I'm immediately signed
# out" reproduced deliberately: same jar, same credentials, no TLS.
c=$(curl -s $RESOLVE -b "$jar" -o /dev/null -w '%{http_code}' "$PLAIN/auth/me")
ok "GET /auth/me over http with the same jar" "$c" "401"

plainjar="$W/plainjar.txt"
c=$(curl -s $RESOLVE -c "$plainjar" -o /dev/null -w '%{http_code}' \
  -X POST "$PLAIN/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}")
ok "login over http still returns" "$c" "200"
# `|| true`, not `|| echo 0`: grep -c prints its count AND exits non-zero when
# that count is zero, so the fallback fired too and the value became "0\n0".
kept=$(grep -c 'edusphere_' "$plainjar" 2>/dev/null || true)
kept=${kept:-0}
# 200 with an empty jar is the whole trap: the credentials were correct, the
# server issued cookies, and the client threw them away.
ok "cookies retained by the client over http" "$kept" "0"
c=$(curl -s $RESOLVE -b "$plainjar" -o /dev/null -w '%{http_code}' "$PLAIN/auth/me")
ok "so the next request over http is unauthenticated" "$c" "401"

printf '\n\033[1m%s\033[0m\n' "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
