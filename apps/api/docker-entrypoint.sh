#!/bin/sh
# Prepares the persistent volume, then drops root and starts the API.
# The SQLite schema is created/updated by the app itself on boot (src/db.ts, CREATE TABLE IF NOT EXISTS).
set -e

DB_DIR="$(dirname "${DATABASE_PATH:-/data/pingsell.db}")"
mkdir -p "$DB_DIR" "${UPLOAD_DIR:-/data/uploads}"

if [ "$(id -u)" = "0" ]; then
  # Coolify mounts volumes owned by root: hand them to the unprivileged user. Only the files that need it:
  # a blanket `chown -R` rewrites the metadata of every upload and backup on each start (slow on a big volume).
  find "$DB_DIR" "${UPLOAD_DIR:-/data/uploads}" -xdev \( ! -user node -o ! -group node \) -exec chown node:node {} +
  exec su-exec node "$@"
fi

exec "$@"
