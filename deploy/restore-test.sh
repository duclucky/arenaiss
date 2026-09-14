#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: deploy/restore-test.sh <backup filename>" >&2
  exit 2
fi

case "$1" in
  */*|*..*) echo "backup filename must not contain a path" >&2; exit 2 ;;
esac

if [ ! -f "backups/$1" ]; then
  echo "backup not found" >&2
  exit 1
fi

docker compose run --rm --no-deps api node scripts/ops/backup-sqlite.mjs --verify "/backups/$1"

