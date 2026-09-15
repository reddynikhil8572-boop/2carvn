#!/usr/bin/env bash
#
# Takes a consistent, restorable dump of the 2carvn database.
#
#   bash scripts/backup.sh
#
# Environment:
#   BACKUP_DATABASE_URL  connection string; defaults to DIRECT_DATABASE_URL from
#                        .env, which is the owning role. The dump must be taken
#                        as the owner: the application role is NOBYPASSRLS, so a
#                        dump taken as edusphere_app would silently contain only
#                        the rows visible to whatever tenant context happened to
#                        be set — that is, none of them.
#   BACKUP_DIR           where to write (default ./backups)
#   BACKUP_RETENTION_DAYS  prune dumps older than this (default 14)
#   BACKUP_PASSPHRASE    if set, the dump is encrypted at rest with it
#
# The dump is in pg_dump's custom format (-Fc): compressed, and restorable
# selectively with pg_restore, unlike a plain SQL file.
#
# WHAT THIS DOES NOT CAPTURE — see docs/DATA_PROTECTION.md:
#   * Roles. pg_dump emits database objects, not cluster-level roles, so a
#     restore onto a fresh cluster must create edusphere_app first or every
#     GRANT in the dump fails.
#   * ENCRYPTION_KEY. Deliberately: the TOTP secrets in this file are AES-GCM
#     ciphertext and are useless without a key that lives only in the
#     environment. Losing a backup does not leak second factors.
set -euo pipefail

cd "$(dirname "$0")/.."

# Sourced, not parsed — which means every value containing shell metacharacters
# must be quoted in .env. MAIL_FROM="Name <addr>" is the one that bites: an
# unquoted `<` is a redirect, and bash aborts the whole file at that line.
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

BACKUP_DIR=${BACKUP_DIR:-./backups}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
URL=${BACKUP_DATABASE_URL:-${DIRECT_DATABASE_URL:-}}

if [ -z "$URL" ]; then
  echo "FATAL: set BACKUP_DATABASE_URL or DIRECT_DATABASE_URL" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="$BACKUP_DIR/edusphere-$stamp.dump"

# Prefer a local pg_dump. Falling back to the db container matters for
# developers: the client tools are frequently absent on a machine that only
# ever runs Postgres in Docker, and a backup script nobody can run is not a
# backup script.
#
# Inside the container the server is on localhost:5432 regardless of whatever
# host port compose published, so the URL is rebuilt from POSTGRES_* rather
# than reused.
if command -v pg_dump >/dev/null 2>&1; then
  echo "Using local pg_dump ($(pg_dump --version))"
  dump() { pg_dump --format=custom --no-owner --no-privileges --dbname="$URL"; }
elif docker compose ps db --status running --quiet >/dev/null 2>&1 &&
     [ -n "$(docker compose ps db --status running --quiet 2>/dev/null)" ]; then
  echo "No local pg_dump; using the db container"
  CONTAINER_URL="postgresql://${POSTGRES_USER:-edusphere}:${POSTGRES_PASSWORD:-edusphere}@localhost:5432/${POSTGRES_DB:-edusphere}"
  dump() {
    docker compose exec -T db \
      pg_dump --format=custom --no-owner --no-privileges --dbname="$CONTAINER_URL"
  }
else
  echo "FATAL: no pg_dump on PATH and the db container is not running" >&2
  exit 1
fi

# --no-owner --no-privileges: ownership and GRANTs are re-established by the
# migrations (20260802160000_app_role), which is the single place that decides
# them. Baking them into the dump means a restore onto a cluster with different
# role names fails halfway through.

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  out="$base.enc"
  # A dump contains every password hash and every encrypted 2FA seed in the
  # system. -iter/-pbkdf2 because openssl's default key derivation is a single
  # MD5 pass, which a passphrase does not survive.
  dump | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
                     -pass env:BACKUP_PASSPHRASE -out "$out"
else
  out="$base"
  echo "WARNING: BACKUP_PASSPHRASE is not set — this dump is written in the clear." >&2
  echo "         It contains every password hash in the database." >&2
  dump > "$out"
fi

# A checksum alongside the dump, so restore.sh can tell a truncated or
# corrupted file from a valid one before it starts writing to a database.
sha256sum "$out" | awk '{print $1}' > "$out.sha256"

size=$(wc -c < "$out" | tr -d ' ')
if [ "$size" -lt 1024 ]; then
  echo "FATAL: dump is only ${size} bytes — treating as a failure, not a backup" >&2
  rm -f "$out" "$out.sha256"
  exit 1
fi

echo "Wrote $out (${size} bytes)"
echo "  sha256 $(cat "$out.sha256")"

# Prune last, and only after a successful write: pruning first would discard
# good backups on a night when the new one fails.
pruned=$(find "$BACKUP_DIR" -name 'edusphere-*.dump*' -type f \
          -mtime "+$BACKUP_RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$pruned" -gt 0 ] && echo "Pruned $pruned file(s) older than $BACKUP_RETENTION_DAYS days"

exit 0
