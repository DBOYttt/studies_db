#!/usr/bin/env bash
# Nightly backup: DB dump + storage volume copy + 14-day dump retention.
# BACKUP_DIR comes from the environment or (parsed, never sourced) from .env.
# The DB root password is read inside the container from its own env, so it
# never appears in `ps`. SKIP_STORAGE=1 skips the rsync step (dev DB only).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${BACKUP_DIR:-}" ] && [ -f .env ]; then
  BACKUP_DIR="$(grep -E '^BACKUP_DIR=' .env | head -n1 | cut -d= -f2- || true)"
fi
: "${BACKUP_DIR:?BACKUP_DIR not set (env or .env)}"
CONTAINER="${DB_CONTAINER:-studies-mariadb}"
mkdir -p "$BACKUP_DIR/storage"

out="$BACKUP_DIR/studies-$(date +%F).sql.gz"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

podman exec "$CONTAINER" sh -c \
  'exec mariadb-dump --single-transaction -uroot -p"$MARIADB_ROOT_PASSWORD" studies' \
  | gzip > "$tmp"

# Verify: valid gzip and the dump ran to completion.
gzip -t "$tmp"
if ! zcat "$tmp" | tail -n1 | grep -q 'Dump completed'; then
  echo "backup FAILED: dump incomplete" >&2
  exit 1
fi
mv "$tmp" "$out"

if [ "${SKIP_STORAGE:-0}" = 1 ]; then
  echo "storage rsync skipped (SKIP_STORAGE=1)"
else
  vol="$(podman volume inspect "${STORAGE_VOLUME:-studies_db_storage}" --format '{{.Mountpoint}}')"
  rsync -a "$vol/" "$BACKUP_DIR/storage/"
fi

# Prune only after a fully successful backup.
find "$BACKUP_DIR" -maxdepth 1 -name 'studies-*.sql.gz' -mtime +14 -delete
echo "backup ok: $out"
