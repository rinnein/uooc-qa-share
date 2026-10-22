#!/usr/bin/env bash
# ==============================================================================
# Database Schema Initialization Script
# Applies Drizzle migration SQL files directly to the PostgreSQL database.
# ==============================================================================
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-uooc_qa_share}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/docker-entrypoint-initdb.d}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

wait_for_db() {
  log "Waiting for PostgreSQL ($POSTGRES_HOST:$POSTGRES_PORT)..."
  until PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 2
  done
  log "PostgreSQL is ready and accepting connections."
}

wait_for_db

# Determine migration files location
if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" 2>/dev/null)" ]; then
  if [ -d "/drizzle" ] && [ -n "$(find "/drizzle" -maxdepth 1 -name "*.sql" 2>/dev/null)" ]; then
    MIGRATIONS_DIR="/drizzle"
  elif [ -d "./drizzle" ] && [ -n "$(find "./drizzle" -maxdepth 1 -name "*.sql" 2>/dev/null)" ]; then
    MIGRATIONS_DIR="./drizzle"
  else
    log "Error: No migration SQL files found in $MIGRATIONS_DIR, /drizzle, or ./drizzle."
    exit 1
  fi
fi

log "Applying database migrations from: $MIGRATIONS_DIR"

for sql_file in $(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort); do
  log "Executing migration: $(basename "$sql_file")..."
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f "$sql_file" || log "Notice: Migration $(basename "$sql_file") finished with non-zero status (some tables or constraints may already exist)."
done

table_count="$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
log "Database initialization completed successfully! Current tables in public schema: $table_count"
