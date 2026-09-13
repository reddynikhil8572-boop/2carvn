#!/usr/bin/env bash
#
# Restores a dump written by backup.sh, and verifies it.
#
#   bash scripts/restore.sh backups/edusphere-20260804T120000Z.dump [target_db]
#
# With no target database it restores into `edusphere_restore_check`, which is
# the mode worth running on a schedule: a backup nobody has restored is a
# hypothesis, not a backup. It drops and recreates the target, so pointing it at
# a live database is destructive and deliberate.
#
# Environment:
#   BACKUP_DATABASE_URL / DIRECT_DATABASE_URL  owner connection (required)
#   BACKUP_PASSPHRASE   required if the file ends in .enc
#   BACKUP_CLIENT_CONTAINER  name of a running container holding the postgres
#                        client tools, used when this machine has none. It must
#                        be able to reach BACKUP_DATABASE_URL as written.
set -euo pipefail

cd "$(dirname "$0")/.."

# An explicitly exported value must beat .env.
#
# `set -a && . ./.env` exports everything the file defines, so a stale .env can
# silently redirect a restore at a cluster the operator did not name. In the
# situation this script exists for, that cluster is the live one being rebuilt,
# and the restore would overwrite it. Captured before, reinstated after.
_preset_url=${BACKUP_DATABASE_URL:-}
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
[ -n "$_preset_url" ] && BACKUP_DATABASE_URL=$_preset_url

FILE=${1:-}
TARGET=${2:-edusphere_restore_check}
URL=${BACKUP_DATABASE_URL:-${DIRECT_DATABASE_URL:-}}

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: bash scripts/restore.sh <dump-file> [target-database]" >&2
  exit 1
fi

if [ -z "$URL" ]; then
  echo "FATAL: set BACKUP_DATABASE_URL or DIRECT_DATABASE_URL" >&2
  exit 1
fi

# Integrity first. Restoring a truncated dump produces a database that looks
# populated and is missing whatever came after the truncation point.
if [ -f "$FILE.sha256" ]; then
  actual=$(sha256sum "$FILE" | awk '{print $1}')
  expected=$(cat "$FILE.sha256")
  if [ "$actual" != "$expected" ]; then
    echo "FATAL: checksum mismatch for $FILE" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
  echo "Checksum OK"
else
  echo "WARNING: no $FILE.sha256 alongside the dump; integrity unverified" >&2
fi

# Same local-or-container selection as backup.sh, for the same reason.
#
# The container branches differ in one way that matters: they run the client
# *somewhere else*, so the URL must be one that resolves from in there. Only the
# no-URL convenience case may assume the compose db is also the server.
if command -v pg_restore >/dev/null 2>&1; then
  psql_run() { psql --dbname="$URL" -v ON_ERROR_STOP=1 "$@"; }
  psql_on()  { local db=$1; shift; psql --dbname="${URL%/*}/$db" -v ON_ERROR_STOP=1 "$@"; }
  restore_run() { pg_restore --no-owner --no-privileges --dbname="${URL%/*}/$TARGET"; }
elif [ -n "${BACKUP_CLIENT_CONTAINER:-}" ]; then
  # Restoring somewhere other than this machine's compose stack — which is the
  # whole point of a backup. $URL is used verbatim and must resolve from inside
  # the named container.
  echo "Using client container \"$BACKUP_CLIENT_CONTAINER\""
  DEX="docker exec -i $BACKUP_CLIENT_CONTAINER"
  psql_run() { $DEX psql --dbname="$URL" -v ON_ERROR_STOP=1 "$@"; }
  psql_on()  { local db=$1; shift; $DEX psql --dbname="${URL%/*}/$db" -v ON_ERROR_STOP=1 "$@"; }
  restore_run() { $DEX pg_restore --no-owner --no-privileges --dbname="${URL%/*}/$TARGET"; }
elif [ -n "$(docker compose ps db --status running --quiet 2>/dev/null)" ]; then
  # Local convenience only. This branch cannot honour a $URL pointing anywhere
  # but the compose db, so it refuses rather than quietly restoring into the
  # wrong database — the failure mode that would have destroyed the source.
  if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
    echo "FATAL: BACKUP_DATABASE_URL is set, but this machine has no pg_restore" >&2
    echo "       and the only client available is the compose db container," >&2
    echo "       which would restore into itself and ignore the URL you gave." >&2
    echo "       Set BACKUP_CLIENT_CONTAINER to a container that can reach it." >&2
    exit 1
  fi
  CU="postgresql://${POSTGRES_USER:-edusphere}:${POSTGRES_PASSWORD:-edusphere}@localhost:5432"
  psql_run() { docker compose exec -T db psql --dbname="$CU/${POSTGRES_DB:-edusphere}" -v ON_ERROR_STOP=1 "$@"; }
  psql_on()  { local db=$1; shift; docker compose exec -T db psql --dbname="$CU/$db" -v ON_ERROR_STOP=1 "$@"; }
  restore_run() { docker compose exec -T db pg_restore --no-owner --no-privileges --dbname="$CU/$TARGET"; }
else
  echo "FATAL: no pg_restore on PATH, no BACKUP_CLIENT_CONTAINER, and the db" >&2
  echo "       container is not running — nothing can talk to a database" >&2
  exit 1
fi

echo "Restoring into \"$TARGET\""

# Terminate stragglers before dropping: DROP DATABASE fails while any session is
# attached, and a previous aborted run can leave one behind.
psql_run -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = '$TARGET' AND pid <> pg_backend_pid()" >/dev/null
psql_run -q -c "DROP DATABASE IF EXISTS \"$TARGET\"" >/dev/null
psql_run -q -c "CREATE DATABASE \"$TARGET\"" >/dev/null

if [ "${FILE##*.}" = "enc" ]; then
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "FATAL: $FILE is encrypted; set BACKUP_PASSPHRASE" >&2
    exit 1
  fi
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
              -pass env:BACKUP_PASSPHRASE -in "$FILE" | restore_run
else
  restore_run < "$FILE"
fi

# ── Verification ────────────────────────────────────────────────────────────
#
# "pg_restore exited 0" is a weak claim: it succeeds on an empty dump. Check
# that the tables the product cannot function without are present, and report
# their row counts so a silently-empty backup is visible at a glance.

echo
echo "Verifying:"

required="schools users refresh_tokens recovery_codes password_reset_tokens audit_logs"
missing=""

for table in $required; do
  present=$(psql_on "$TARGET" -tAc \
    "SELECT to_regclass('public.$table') IS NOT NULL") || present=f
  if [ "$present" != "t" ]; then
    missing="$missing $table"
    printf '  MISSING  %s\n' "$table"
    continue
  fi
  count=$(psql_on "$TARGET" -tAc "SELECT count(*) FROM \"$table\"")
  printf '  ok       %-24s %s row(s)\n' "$table" "$count"
done

# The migration history is what tells you the dump matches a known schema
# version rather than something half-migrated.
applied=$(psql_on "$TARGET" -tAc \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo 0)
printf '  ok       %-24s %s applied\n' "_prisma_migrations" "$applied"

# The tenant boundary is the RLS policies and the definer functions, not the
# tables. A restore that brought back every row but no policy would look
# entirely healthy here and serve every school's data to every school, so this
# is the check that actually matters.
policies=$(psql_on "$TARGET" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")
forced=$(psql_on "$TARGET" -tAc \
  "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relforcerowsecurity")
definers=$(psql_on "$TARGET" -tAc \
  "SELECT count(*) FROM pg_proc WHERE prosecdef AND pronamespace='public'::regnamespace")

printf '  %-8s %-24s %s\n' "$([ "$policies" -gt 0 ] && echo ok || echo MISSING)" \
  "RLS policies" "$policies"
printf '  %-8s %-24s %s\n' "$([ "$forced" -gt 0 ] && echo ok || echo MISSING)" \
  "FORCE row security" "$forced tables"
printf '  %-8s %-24s %s\n' "$([ "$definers" -gt 0 ] && echo ok || echo MISSING)" \
  "SECURITY DEFINER fns" "$definers"

echo
if [ -n "$missing" ]; then
  echo "RESTORE FAILED — missing tables:$missing" >&2
  exit 1
fi

if [ "$applied" -eq 0 ]; then
  echo "RESTORE FAILED — no completed migrations in the restored database" >&2
  exit 1
fi

if [ "$policies" -eq 0 ] || [ "$forced" -eq 0 ]; then
  echo "RESTORE FAILED — the restored database has no tenant isolation" >&2
  exit 1
fi

echo "Restore verified into \"$TARGET\"."

# ── Role and privileges ─────────────────────────────────────────────────────
#
# This used to be a printed note telling the operator to create edusphere_app
# themselves. The 2026-08-06 rehearsal showed why a note is not enough: the
# dump carries 0 of the source's 102 grants, `migrate deploy` will not re-apply
# them because the restored _prisma_migrations says everything is done, and the
# obvious manual fix — re-running the grants — silently re-grants DELETE on
# video_events and destroys the append-only guarantee.
#
# So the script does it, from the one file that states the end state in order.
PRIV_SQL=prisma/sql/app-role-privileges.sql

echo
if [ ! -f "$PRIV_SQL" ]; then
  echo "RESTORE INCOMPLETE — $PRIV_SQL is missing, so the application role" >&2
  echo "  has no privileges in \"$TARGET\" and the app cannot read a single row." >&2
  exit 1
fi

echo "Applying application-role privileges:"
psql_on "$TARGET" -q < "$PRIV_SQL"

granted=$(psql_on "$TARGET" -tAc \
  "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='edusphere_app'")
printf '  %-8s %-24s %s\n' "$([ "$granted" -gt 0 ] && echo ok || echo MISSING)" \
  "table grants" "$granted"

# Assert the exception, not just the baseline. A re-grant that flattened the
# privilege model would leave `granted` looking healthier than before while
# quietly handing the internet-facing role the ability to erase viewing
# history, so the append-only property is checked explicitly.
appendonly=$(psql_on "$TARGET" -tAc \
  "SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee='edusphere_app' AND table_name='video_events'
      AND privilege_type IN ('UPDATE','DELETE')")
printf '  %-8s %-24s %s\n' "$([ "$appendonly" -eq 0 ] && echo ok || echo BROKEN)" \
  "video_events append-only" "$([ "$appendonly" -eq 0 ] && echo "no UPDATE/DELETE" || echo "$appendonly grant(s) — LEAK")"

# The role deliberately has no password until one is applied, so a restore is
# not finished when this script exits.
superuser=$(psql_on "$TARGET" -tAc \
  "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='edusphere_app'")
printf '  %-8s %-24s %s\n' "$([ "$superuser" = "f" ] && echo ok || echo BROKEN)" \
  "not superuser/bypassrls" "$superuser"

echo
if [ "$granted" -eq 0 ] || [ "$appendonly" -ne 0 ] || [ "$superuser" != "f" ]; then
  echo "RESTORE FAILED — application role privileges are wrong in \"$TARGET\"" >&2
  exit 1
fi

echo "Application role ready in \"$TARGET\"."
echo
echo "Still to do by hand — the role has no password, deliberately:"
echo "      APP_DB_PASSWORD=... node dist/scripts/setAppRolePassword.js"
echo "      (or: npx ts-node src/scripts/setAppRolePassword.ts)"
echo "Without it the application cannot authenticate at all, which is the"
echo "correct failure mode: no password means no access, not a default one."
echo "Restoring 2FA users also needs the ORIGINAL ENCRYPTION_KEY — it is"
echo "deliberately not in the dump, so a restore without it strands them."
