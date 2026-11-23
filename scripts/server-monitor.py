#!/usr/bin/env python3
"""
Монитор приложений на сервере: сайты, контейнеры, место на диске.
Падение -> письмо; восстановление -> письмо; пока не работает — повтор раз в час.

Запуск: cron каждые 15 минут от root.
Конфиг: /etc/school-survey-monitor.conf (chmod 600), строки key=value:
  SMTP_USER=aleksej308@yandex.ru
  SMTP_PASS=пароль_приложения_почты
  ALERT_TO=aleksey.baranov@digi-base.ru
  DISK_MAX=85            # % занятости корня для тревоги (необязательно)
  REPEAT_AFTER=3600      # секунд между повторами тревоги (необязательно)

Дополнительно: python3 server-monitor.py --test-email  — отправить тестовое письмо.
"""

import json
import os
import shutil
import smtplib
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage

CONF_PATH = "/etc/school-survey-monitor.conf"
STATE_PATH = "/var/lib/school-survey-monitor/state.json"
SMTP_HOST, SMTP_PORT = "smtp.yandex.ru", 465

SITES = {
    "school-survey": "https://school-survey.digi-base.pro/api/bootstrap",
    "vika-opros": "https://vika-opros.digi-base.pro/api/bootstrap",
    "bp-editor": "https://bp.digi-base.pro/",
    "demo": "https://demo.digi-base.pro/",
}
CONTAINERS = [
    "school-survey",
    "vika-opros",
    "bp-editor",
    "demo-equipment-db-1",
    "demo-equipment-backend-1",
    "demo-equipment-frontend-1",
]


def load_conf():
    conf = {}
    with open(CONF_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip()
    return conf


def check_site(url):
    """200 -> None, иначе текст причины."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "server-monitor"})
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status == 200:
                return None
            return f"HTTP {r.status}"
    except Exception as e:
        return str(e)[:120]


def check_container(name):
    out = subprocess.run(
        ["docker", "ps", "-q", "-f", f"name=^{name}$"],
        capture_output=True, text=True,
    )
    return None if out.stdout.strip() else "контейнер не запущен"


def check_disk(max_pct):
    pct = int(shutil.disk_usage("/").used / shutil.disk_usage("/").total * 100)
    return None if pct < max_pct else f"диск занят {pct}% (порог {max_pct}%)"


def run_checks(conf):
    results = {}
    for name, url in SITES.items():
        fail = check_site(url)
        if fail:  # одиночный сбой может быть сетевым миганием — перепроверяем
            time.sleep(5)
            fail = check_site(url)
        results[f"сайт:{name}"] = fail
    for name in CONTAINERS:
        results[f"контейнер:{name}"] = check_container(name)
    results["диск:/"] = check_disk(int(conf.get("DISK_MAX", "85")))
    return results


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)


def send_email(conf, subject, body):
    msg = EmailMessage()
    msg["From"] = conf["SMTP_USER"]
    msg["To"] = conf["ALERT_TO"]
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as s:
        s.login(conf["SMTP_USER"], conf["SMTP_PASS"])
        s.send_message(msg)


def main():
    conf = load_conf()
    if "--test-email" in sys.argv:
        send_email(conf, "Монитор сервера: тестовое письмо",
                   "Если вы получили это письмо — настройка уведомлений работает.")
        print("Тестовое письмо отправлено на", conf["ALERT_TO"])
        return

    now = time.time()
    state = load_state()
    results = run_checks(conf)
    failing = {k: v for k, v in results.items() if v}

    down_now = set(failing)
    was_down = set(state.get("failing", {}))
    to_alert, to_recover = [], []

    for k in down_now:
        prev = state.get("failing", {}).get(k)
        if prev is None:
            to_alert.append(k)                      # новое падение
        elif now - prev.get("sent_at", 0) >= int(conf.get("REPEAT_AFTER", "3600")):
            to_alert.append(k)                      # повтор напоминания
    for k in was_down - down_now:
        to_recover.append(k)                        # восстановилось

    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")

    if to_alert:
        lines = [f"{k}: {failing[k]}" for k in sorted(to_alert)]
        send_email(conf, "Сервер: приложение НЕДОСТУПНО",
                   f"Время: {stamp}\n\n" + "\n".join(lines)
                   + "\n\nСервер: 193.233.245.207, проверка раз в 15 минут.")
        for k in to_alert:
            state.setdefault("failing", {})[k] = {"sent_at": now, "reason": failing[k]}
        print(stamp, "ALERT:", "; ".join(to_alert))
    if to_recover:
        lines = sorted(to_recover)
        send_email(conf, "Сервер: работа восстановлена",
                   f"Время: {stamp}\n\nСнова работают:\n" + "\n".join(lines))
        for k in to_recover:
            state.get("failing", {}).pop(k, None)
        print(stamp, "RECOVER:", "; ".join(lines))
    if not to_alert and not to_recover:
        quiet = "нет проблем" if not failing else f"проблемы продолжаются: {len(failing)}"
        print(stamp, "OK:", quiet)

    save_state(state)


if __name__ == "__main__":
    main()
