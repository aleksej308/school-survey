#!/usr/bin/env python3
"""
Монитор приложений на сервере: сайты, контейнеры, место на диске.
Падение -> сообщение в Telegram; восстановление -> сообщение; пока не работает —
повтор раз в час.

Запуск: cron каждые 15 минут от root.
Конфиг: /etc/school-survey-monitor.conf (chmod 600), строки key=value:
  TG_TOKEN=1234567890:AA...     (токен бота от @BotFather)
  TG_CHAT_ID=123456789          (ваш id, узнаётся у @userinfobot)
  DISK_MAX=85                   # % занятости корня для тревоги (необязательно)
  REPEAT_AFTER=3600             # секунд между повторами тревоги (необязательно)

Дополнительно: python3 server-monitor.py --test  — отправить тестовое сообщение.
"""

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

CONF_PATH = "/etc/school-survey-monitor.conf"
STATE_PATH = "/var/lib/school-survey-monitor/state.json"

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


def send_telegram(conf, text):
    url = f"https://api.telegram.org/bot{conf['TG_TOKEN']}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": conf["TG_CHAT_ID"],
        "text": text,
    }).encode()
    req = urllib.request.Request(url, data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        if r.status != 200:
            raise RuntimeError(f"Telegram API вернул {r.status}")


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


def main():
    conf = load_conf()
    if "--test" in sys.argv or "--test-email" in sys.argv:
        send_telegram(conf, "✅ Монитор сервера работает: тестовое сообщение.")
        print("Тестовое сообщение отправлено в Telegram.")
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
        lines = "\n".join(f"• {k}: {failing[k]}" for k in sorted(to_alert))
        send_telegram(conf,
                      f"🔴 Сервер: приложение НЕДОСТУПНО\nВремя: {stamp}\n\n{lines}"
                      f"\n\n193.233.245.207 · проверка раз в 15 минут")
        for k in to_alert:
            state.setdefault("failing", {})[k] = {"sent_at": now, "reason": failing[k]}
        print(stamp, "ALERT:", "; ".join(to_alert))
    if to_recover:
        lines = "\n".join(f"• {k}" for k in sorted(to_recover))
        send_telegram(conf, f"🟢 Сервер: работа восстановлена\nВремя: {stamp}\n\n{lines}")
        for k in to_recover:
            state.get("failing", {}).pop(k, None)
        print(stamp, "RECOVER:", ", ".join(sorted(to_recover)))
    if not to_alert and not to_recover:
        quiet = "нет проблем" if not failing else f"проблемы продолжаются: {len(failing)}"
        print(stamp, "OK:", quiet)

    save_state(state)


if __name__ == "__main__":
    main()
