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
  # не прерывая работу приложения. Файл-остаток от прошлого прогона
  # обязательно убираем — VACUUM INTO не перезаписывает существующее.
  docker exec "$name" rm -f /tmp/backup-snap.db /app/data/backup-snap.db
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

# ---------- bp-editor: bind-папка с данными (SQLite и файлы) ----------
if [ -d /opt/bp-editor-repo/docker-data ]; then
  tar czf "$OUT_DIR/bp-editor-$STAMP.tar.gz" -C /opt/bp-editor-repo docker-data
  ln -sf "bp-editor-$STAMP.tar.gz" "$OUT_DIR/bp-editor-latest.tar.gz"
  echo "OK: bp-editor -> $OUT_DIR/bp-editor-$STAMP.tar.gz ($(du -h "$OUT_DIR/bp-editor-$STAMP.tar.gz" | cut -f1))"
fi

# ---------- demo-equipment: PostgreSQL dump + uploads ----------
if [ "$(docker ps -q -f name=^/demo-equipment-db-1$)" != "" ]; then
  docker exec demo-equipment-db-1 pg_dump -U demo -d demo | gzip > "$OUT_DIR/demo-equipment-db-$STAMP.sql.gz"
  ln -sf "demo-equipment-db-$STAMP.sql.gz" "$OUT_DIR/demo-equipment-db-latest.sql.gz"
  echo "OK: demo-equipment-db -> $OUT_DIR/demo-equipment-db-$STAMP.sql.gz ($(du -h "$OUT_DIR/demo-equipment-db-$STAMP.sql.gz" | cut -f1))"
fi
if docker volume inspect demo-equipment_uploads >/dev/null 2>&1; then
  # postgres:16-alpine уже есть на сервере — используем его как одноразовый tar
  docker run --rm -v demo-equipment_uploads:/src:ro -v "$OUT_DIR":/backup postgres:16-alpine \
    tar czf "/backup/demo-equipment-uploads-$STAMP.tar.gz" -C /src .
  ln -sf "demo-equipment-uploads-$STAMP.tar.gz" "$OUT_DIR/demo-equipment-uploads-latest.tar.gz"
  echo "OK: demo-equipment-uploads -> $OUT_DIR/demo-equipment-uploads-$STAMP.tar.gz ($(du -h "$OUT_DIR/demo-equipment-uploads-$STAMP.tar.gz" | cut -f1))"
fi

# ---------- чистка: оставляем последние KEEP_DAYS ----------
find "$OUT_DIR" \( -name "*-20*.tar.gz" -o -name "*-20*.sql.gz" \) -mtime +"$KEEP_DAYS" -delete

# ---------- Яндекс.Диск (WebDAV): копия в облако, там храним CLOUD_KEEP_DAYS ----------
# Реквизиты: /etc/yadisk-credentials (chmod 600):
#   YADISK_USER=логин
#   YADISK_PASS=пароль_приложения
#   YADISK_DIR=AI проекты/Backups   (папка на Диске, кириллица допустима)
# Нет файла — загрузка пропускается, локальные копии продолжают создаваться.
CLOUD_KEEP_DAYS="${CLOUD_KEEP_DAYS:-30}"
if [ -f /etc/yadisk-credentials ]; then
  # shellcheck disable=SC1091
  . /etc/yadisk-credentials
  WEBDAV="https://webdav.yandex.ru"
  AUTH="$YADISK_USER:$YADISK_PASS"
  # URL-кодируем путь (кириллица/пробелы) по компонентам, сохраняя слэши
  CLOUD_DIR_ENC=$(python3 -c "
import urllib.parse, sys
print('/'.join(urllib.parse.quote(p) for p in sys.argv[1].split('/')))
" "${YADISK_DIR:-backups/school-survey}")

  upload() { curl -sf -u "$AUTH" -T "$1" "$WEBDAV/$CLOUD_DIR_ENC/$2"; }
  # папка уже должна существовать; MKCOL игнорируем (405 «уже есть» — норм)
  curl -s -u "$AUTH" -X MKCOL "$WEBDAV/$CLOUD_DIR_ENC" >/dev/null 2>&1

  for f in "$OUT_DIR"/*-latest.tar.gz "$OUT_DIR"/*-latest.sql.gz; do
    [ -e "$f" ] || continue
    name="$(basename "$f" | sed 's/-latest\./'"-$STAMP."'/')"
    if upload "$f" "$name"; then
      echo "CLOUD: $name загружен на Яндекс.Диск"
    else
      echo "CLOUD: не удалось загрузить $name (проверьте /etc/yadisk-credentials)" >&2
    fi
  done

  # Чистка облака: дата зашита в имени файла (-YYYY-MM-DD.), удаляем старше N дней
  cutoff=$(date -d "$CLOUD_KEEP_DAYS days ago" +%Y-%m-%d)
  cloud_list=$(curl -sf -u "$AUTH" -X PROPFIND -H "Depth: 1" "$WEBDAV/$CLOUD_DIR_ENC" \
    | grep -oE '[a-zA-Z0-9._-]+-20[0-9]{2}-[0-9]{2}-[0-9]{2}\.(tar\.gz|sql\.gz)' | sort -u)
  for name in $cloud_list; do
    fdate=$(echo "$name" | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}')
    if [ "$fdate" \< "$cutoff" ]; then
      curl -sf -u "$AUTH" -X DELETE "$WEBDAV/$CLOUD_DIR_ENC/$name" \
        && echo "CLOUD: удалена старая копия $name"
    fi
  done
else
  echo "CLOUD: пропущено — нет /etc/yadisk-credentials"
fi
