#!/usr/bin/env bash
#
# Развёртывание «Школьные опросы» на Ubuntu: Docker + nginx + Let's Encrypt (HTTPS).
#
# Запуск от root:
#   sudo bash deploy.sh <домен> [email]
#
# Пример:
#   sudo bash deploy.sh опросы.школа.рф admin@школа.рф
#
# Скрипт идемпотентен: безопасно запускать повторно при обновлениях.
# HTTPS-конфиг nginx пишется самим скриптом (certbot НЕ модифицирует конфиг),
# поэтому повторный запуск не ломает уже настроенный SSL.
#
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$DOMAIN" ]]; then
  echo "Использование: sudo bash deploy.sh <домен> [email]" >&2
  echo "Пример:       sudo bash deploy.sh опросы.школа.рф admin@школа.рф" >&2
  exit 1
fi

# ---------- пароль администратора (важен только при первом запуске) ----------
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -rsp "Пароль администратора приложения: " ADMIN_PASSWORD; echo
fi
if [[ ${#ADMIN_PASSWORD} -lt 6 ]]; then
  echo "Ошибка: пароль должен содержать не менее 6 символов." >&2
  exit 1
fi

# ---------- Docker ----------
echo "==> Проверка Docker"
command -v docker >/dev/null || { echo "Docker не установлен. См. https://docs.docker.com/engine/install/ubuntu/" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null; then
  COMPOSE=(docker-compose)
else
  echo "Не найден docker compose." >&2; exit 1
fi

# ---------- nginx ----------
echo "==> Установка nginx (если отсутствует)"
if ! command -v nginx >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx
fi

# ---------- выбор свободного хост-порта ----------
APP_PORT="${APP_PORT:-}"
if [[ -z "$APP_PORT" ]]; then
  APP_PORT=3000
  if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":3000 "; then
    for p in $(seq 8080 8099); do
      if ! ss -ltn 2>/dev/null | grep -q ":${p} "; then APP_PORT=$p; break; fi
    done
  fi
fi
echo "==> Хост-порт приложения: ${APP_PORT}"

# ---------- приложение ----------
echo "==> Сборка и запуск приложения"
cd "$APP_DIR"
export ADMIN_PASSWORD TRUST_PROXY=1 BIND_HOST=127.0.0.1 APP_PORT
"${COMPOSE[@]}" up -d --build

# ---------- HTTPS-сертификат (выпускаем один раз, если его ещё нет) ----------
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [[ ! -f "$CERT_PATH" ]]; then
  echo "==> Получение HTTPS-сертификата"
  if ! command -v certbot >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y certbot python3-certbot-nginx
  fi

  # Временный HTTP-конфиг, чтобы certbot прошёл проверку домена.
  cat > /etc/nginx/sites-available/school-survey <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 5m;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/school-survey /etc/nginx/sites-enabled/school-survey
  nginx -t && systemctl reload nginx

  CERT_ARGS=(certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos)
  if [[ -n "$EMAIL" ]]; then
    CERT_ARGS+=(-m "$EMAIL")
  else
    CERT_ARGS+=(--register-unsafely-without-email)
  fi
  certbot "${CERT_ARGS[@]}"

  # После обновления сертификата перезагружаем nginx автоматически.
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/nginx-reload <<'HOOK'
#!/bin/sh
systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx-reload
else
  echo "==> Сертификат для ${DOMAIN} уже существует"
fi

# ---------- финальный nginx-конфиг (HTTP→HTTPS + SSL), пишется всегда ----------
echo "==> Настройка nginx (HTTPS)"
cat > /etc/nginx/sites-available/school-survey <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 5m;
    }
}
EOF
ln -sf /etc/nginx/sites-available/school-survey /etc/nginx/sites-enabled/school-survey
# Чужие конфиги не трогаем — только проверяем и перезагружаем nginx.
nginx -t && systemctl reload nginx

# ---------- firewall (если включён ufw) ----------
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "==> Открываем порты 80/443 в ufw"
  ufw allow 'Nginx Full' >/dev/null 2>&1 || { ufw allow 80/tcp; ufw allow 443/tcp; }
fi

echo
echo "====================================================="
echo " Готово! Приложение доступно: https://${DOMAIN}"
echo " Данные БД — в volume school-survey_survey-data."
echo " Для обновления: git pull && sudo bash deploy.sh ${DOMAIN} ${EMAIL}"
echo "====================================================="
