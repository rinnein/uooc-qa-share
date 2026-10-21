#!/usr/bin/env bash
# ==============================================================================
# PostgreSQL Partial Daily Backup Script
# Automatically exports core QA tables (courses, task_groups, questions, answers)
# and manages rotation to prevent disk exhaustion.
# ==============================================================================
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-uooc_qa_share}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_TABLES="${BACKUP_TABLES:-courses task_groups questions answers}"
DAILY_TIME="${DAILY_TIME:-02:00}"
BACKUP_ON_START="${BACKUP_ON_START:-true}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

wait_for_db() {
  log "Waiting for PostgreSQL ($POSTGRES_HOST:$POSTGRES_PORT)..."
  until PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 3
  done
  log "PostgreSQL is ready and accepting connections."
}

do_backup() {
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local target_file="${BACKUP_DIR}/qa_backup_${timestamp}.sql.gz"
  local latest_file="${BACKUP_DIR}/qa_backup_latest.sql.gz"

  log "Starting partial backup for tables: $BACKUP_TABLES"

  local table_args=()
  for t in $BACKUP_TABLES; do
    table_args+=("-t" "$t")
  done

  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    "${table_args[@]}" | gzip -9 > "$target_file"

  # Update latest backup pointer
  cp -f "$target_file" "$latest_file"

  local file_size
  file_size="$(du -h "$target_file" | cut -f1)"
  log "Backup successful: $target_file ($file_size)"
  log "Latest pointer updated: $latest_file"

  # Rotate and clean old backups
  if [ -n "$BACKUP_KEEP_DAYS" ] && [ "$BACKUP_KEEP_DAYS" -gt 0 ]; then
    log "Cleaning backups older than $BACKUP_KEEP_DAYS days..."
    find "$BACKUP_DIR" -type f -name "qa_backup_*.sql.gz" ! -name "qa_backup_latest.sql.gz" -mtime +"$BACKUP_KEEP_DAYS" -delete || true
  fi
}

calc_sleep_seconds() {
  local target_time="$DAILY_TIME"
  local now_sec target_sec diff
  now_sec="$(date +%s)"
  target_sec="$(date -d "today $target_time" +%s 2>/dev/null || date -d "$target_time" +%s)"

  if [ "$target_sec" -le "$now_sec" ]; then
    target_sec="$(date -d "tomorrow $target_time" +%s 2>/dev/null || echo $((target_sec + 86400)))"
  fi

  diff=$((target_sec - now_sec))
  echo "$diff"
}

# If called with --now, run a single backup and exit
if [ "${1:-}" = "--now" ]; then
  wait_for_db
  do_backup
  exit 0
fi

# Daemon schedule mode
wait_for_db

if [ "${BACKUP_ON_START,,}" = "true" ] || [ "$BACKUP_ON_START" = "1" ]; then
  log "Running initial backup on container start..."
  do_backup
fi

log "Backup daemon started. Scheduled daily time: $DAILY_TIME (Retention: $BACKUP_KEEP_DAYS days)"

trap 'log "Stopping backup daemon..."; exit 0' SIGTERM SIGINT

while true; do
  sleep_seconds="$(calc_sleep_seconds)"
  target_date="$(date -d "@$(( $(date +%s) + sleep_seconds ))" '+%Y-%m-%d %H:%M:%S')"
  log "Next daily backup scheduled at: $target_date (sleeping for $(( sleep_seconds / 3600 ))h $(( (sleep_seconds % 3600) / 60 ))m)"

  # Sleep in chunks to allow responsive shutdown signal handling
  while [ "$sleep_seconds" -gt 0 ]; do
    step=$(( sleep_seconds > 60 ? 60 : sleep_seconds ))
    sleep "$step"
    sleep_seconds=$(( sleep_seconds - step ))
  done

  do_backup
done
