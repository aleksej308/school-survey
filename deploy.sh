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
# Пароль администратора приложения задаётся через переменную ADMIN_PASSWORD,
# иначе скрипт спросит его интерактивно (действует только при первом запуске).
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

# ---------- пароль администратора ----------
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

# ---------- приложение ----------
echo "==> Сборка и запуск приложения"
cd "$APP_DIR"
# Передаём параметры через окружение (Compose прочитает их как ${ADMIN_PASSWORD} и т.д.).
export ADMIN_PASSWORD TRUST_PROXY=1 BIND_HOST=127.0.0.1
"${COMPOSE[@]}" up -d --build

# ---------- nginx: обратный прокси ----------
echo "==> Настройка nginx (HTTP-этап)"
cat > /etc/nginx/sites-available/school-survey <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 5m;
    }
}
EOF
ln -sf /etc/nginx/sites-available/school-survey /etc/nginx/sites-enabled/school-survey
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------- HTTPS (Let's Encrypt) ----------
echo "==> Получение HTTPS-сертификата"
if ! command -v certbot >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y certbot python3-certbot-nginx
fi

CERT_ARGS=(--nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect)
if [[ -n "$EMAIL" ]]; then
  CERT_ARGS+=(-m "$EMAIL")
else
  CERT_ARGS+=(--register-unsafely-without-email)
fi

if certbot certificates 2>/dev/null | grep -q "Certificate Name: ${DOMAIN}"; then
  echo "Сертификат для ${DOMAIN} уже существует — пропускаем выдачу."
else
  certbot "${CERT_ARGS[@]}"
fi

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
