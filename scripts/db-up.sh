#!/bin/sh
set -e
NAME=studies-mariadb

if podman container exists "$NAME"; then
  podman start "$NAME" >/dev/null
else
  podman run -d --name "$NAME" \
    -p 3307:3306 \
    -e MARIADB_ROOT_PASSWORD=devroot \
    -e MARIADB_DATABASE=studies \
    -v studies-mariadb-data:/var/lib/mysql \
    docker.io/library/mariadb:11 \
    --character-set-server=utf8mb4 \
    --collation-server=utf8mb4_unicode_ci \
    --innodb-ft-min-token-size=2 >/dev/null
fi

echo "Waiting for MariaDB..."
until podman exec "$NAME" mariadb -uroot -pdevroot -h127.0.0.1 -e "SELECT 1" >/dev/null 2>&1; do
  sleep 1
done
podman exec "$NAME" mariadb -uroot -pdevroot \
  -e "CREATE DATABASE IF NOT EXISTS studies_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
echo "MariaDB ready on 127.0.0.1:3307 (databases: studies, studies_test)"
