#!/usr/bin/env bash
#
# Резервная копия данных инстансов «Школьные опросы»: согласованный снапшот
# SQLite (VACUUM INTO внутри контейнера) + загруженные логотип/фото.
# Ставится в cron от root; хранит последние KEEP_DAYS копий каждого инстанса.
#
# Ручной запуск:  bash scripts/server-backup.sh [инстанс1 инстанс2 ...]
# По умолчанию бэкапятся все контейнеры school-survey и vika-opros.
#
set -euo pipefail

KEEP_DAYS="${KEEP_DAYS:-14}"
OUT_DIR="${BACKUP_DIR:-/var/backups/school-survey}"
STAMP="$(date +%Y-%m-%d)"
INSTANCES=("$@")

if [ ${#INSTANCES[@]} -eq 0 ]; then
  INSTANCES=(school-survey vika-opros)
fi

mkdir -p "$OUT_DIR"

for name in "${INSTANCES[@]}"; do
  if [ "$(docker ps -q -f name="^/$name$")" = "" ]; then
    echo "ПРОПУСК: контейнер $name не запущен" >&2
    continue
  fi

  # Согласованный снапшот БД: VACUUM INTO пишет консистентную копию,
  # не прерывая работу приложения.
  docker exec "$name" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/app/data/app.db');
    db.exec(\"VACUUM INTO '/tmp/backup-snap.db'\");
    db.close();
  " >/dev/null 2>&1

  # Снапшот БД + папка uploads одним архивом. busybox tar не умеет два -C,
  # поэтому временный файл кладём рядом с uploads и убираем после упаковки.
  docker exec "$name" sh -c '
    mkdir -p /app/data/uploads
    cp /tmp/backup-snap.db /app/data/backup-snap.db
    tar czf - -C /app/data backup-snap.db uploads
    rm -f /app/data/backup-snap.db /tmp/backup-snap.db
  ' > "$OUT_DIR/$name-$STAMP.tar.gz"

  ln -sf "$name-$STAMP.tar.gz" "$OUT_DIR/$name-latest.tar.gz"
  echo "OK: $name -> $OUT_DIR/$name-$STAMP.tar.gz ($(du -h "$OUT_DIR/$name-$STAMP.tar.gz" | cut -f1))"
done

find "$OUT_DIR" -name "*-20*.tar.gz" -mtime +"$KEEP_DAYS" -delete
