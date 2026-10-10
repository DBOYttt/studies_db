#!/bin/sh
# Nightly backup: DB dump + storage volume copy + 14-day dump retention.
# Needs MARIADB_ROOT_PASSWORD and BACKUP_DIR in the environment (or in .env).
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${MARIADB_ROOT_PASSWORD:?MARIADB_ROOT_PASSWORD not set}"
: "${BACKUP_DIR:?BACKUP_DIR not set}"
mkdir -p "$BACKUP_DIR/storage"

out="$BACKUP_DIR/studies-$(date +%F).sql.gz"
podman exec studies-mariadb mariadb-dump --single-transaction -uroot -p"$MARIADB_ROOT_PASSWORD" studies | gzip > "$out.tmp"
mv "$out.tmp" "$out"

vol="$(podman volume inspect "${STORAGE_VOLUME:-studies_db_storage}" --format '{{.Mountpoint}}')"
rsync -a "$vol/" "$BACKUP_DIR/storage/"

find "$BACKUP_DIR" -maxdepth 1 -name 'studies-*.sql.gz' -mtime +14 -delete
echo "backup ok: $out"
