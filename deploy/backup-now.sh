#!/bin/sh
set -eu

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="/backups/arena-runtime-${timestamp}.sqlite"
docker compose exec -T api node scripts/ops/backup-sqlite.mjs /data/arena-runtime.sqlite "$destination"

