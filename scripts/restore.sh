#!/usr/bin/env bash
# ==============================================================================
# PostgreSQL Backup Restore Script
# Restores QA database tables from a .sql or .sql.gz backup file.
# ==============================================================================
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-uooc_qa_share}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DEFAULT_FILE="${BACKUP_DIR}/qa_backup_latest.sql.gz"

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

# Determine backup file to restore
TARGET_FILE="${1:-$DEFAULT_FILE}"

if [ ! -f "$TARGET_FILE" ]; then
  # Try relative path inside BACKUP_DIR
  if [ -f "${BACKUP_DIR}/${TARGET_FILE}" ]; then
    TARGET_FILE="${BACKUP_DIR}/${TARGET_FILE}"
  elif [ -f "./backups/${TARGET_FILE}" ]; then
    TARGET_FILE="./backups/${TARGET_FILE}"
  else
    log "Error: Backup file '$TARGET_FILE' does not exist."
    log "Available backups in $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR"/*.sql* 2>/dev/null || echo "  (no backup files found)"
    exit 1
  fi
fi

wait_for_db

log "Starting database restore from: $TARGET_FILE"

if [[ "$TARGET_FILE" == *.gz ]]; then
  gzip -dc "$TARGET_FILE" | PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB"
else
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f "$TARGET_FILE"
fi

table_count="$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
log "Database restore completed successfully! Current tables in public schema: $table_count"
