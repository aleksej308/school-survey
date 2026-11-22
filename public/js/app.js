'use strict';

/* ================= helpers ================= */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function setTitle(t) {
  document.title = t ? `${t} — Школьные опросы` : 'Школьные опросы';
}

// Дата-время из БД (UTC: created_at, published_at) -> локальное время браузера.
function fmtDb(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString('ru-RU', { hour12: false });
}

// «Настенное» время расписания (open_at/close_at вводятся как локальное время).
function fmtWall(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString('ru-RU', { hour12: false });
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function fmtDateShort(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s);
  const now = new Date();
  const dayMonth = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear()
    ? dayMonth
    : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function daysUntil(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

async function api(method, url, body, raw) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  };
  if (body !== undefined && !raw) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (raw) {
    opts.headers['Content-Type'] = raw.type || 'application/octet-stream';
    opts.body = raw.body;
  }
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) throw new Error((data && data.error) || `Ошибка ${res.status}`);
  return data;
}

/* ---------- SVG-иконки (вместо emoji — единый стиль на всех платформах) ---------- */

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  surveys: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
  classes: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="14" x2="14" y2="17"/><line x1="21" y1="14" x2="21" y2="17"/><line x1="14" y1="21" x2="21" y2="21"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
};

function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------- модальные окна (вместо alert/confirm/prompt) ---------- */

function openModal(innerHtml, className = '') {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true">${innerHtml}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  return { el: wrap, close };
}

function uiConfirm({ title, message, okLabel = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3>${esc(title)}</h3>
      <p class="muted" style="margin:10px 0 0">${esc(message)}</p>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn ghost" data-no>Отмена</button>
        <button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(okLabel)}</button>
      </div>`);
    el.querySelector('[data-no]').addEventListener('click', () => { close(); resolve(false); });
    el.querySelector('[data-yes]').addEventListener('click', () => { close(); resolve(true); });
  });
}

/* ---------- QR-код ---------- */

function drawQr(canvas, text, px = 240) {
  const m = makeQrMatrix(text);
  const quiet = 4;
  const n = m.length + quiet * 2;
  const scale = Math.max(2, Math.floor(px / n));
  canvas.width = canvas.height = n * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (m[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
}

function showShareModal(id, title) {
  const link = location.origin + '/s/' + id;
  const { el, close } = openModal(`
    <h3>Ссылка и QR-код</h3>
    <p class="small muted" style="margin:6px 0 12px">${esc(title)}</p>
    <div class="center"><canvas id="qrCanvas" class="qr-canvas"></canvas></div>
    <div class="share-link">
      <input id="qrLink" readonly value="${esc(link)}">
      <button class="btn small" id="qrCopy">${icon('copy', 15)} Копировать</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">Наведите камеру телефона на QR-код — или перешлите ссылку в чат класса.</p>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn ghost block" id="qrClose">Закрыть</button>
    </div>`);
  drawQr(el.querySelector('#qrCanvas'), link);
  el.querySelector('#qrClose').addEventListener('click', close);
  el.querySelector('#qrCopy').addEventListener('click', async () => {
    const inp = el.querySelector('#qrLink');
    try {
      await navigator.clipboard.writeText(link);
      toast('Ссылка скопирована');
    } catch {
      inp.select();
      document.execCommand('copy');
      toast('Ссылка скопирована');
    }
  });
}

/* ---------- мини-графики (SVG, без библиотек) ---------- */

const CHART_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b'];

// Столбики «ответы по дням».
function byDaySvg(byDay, w = 640, h = 96) {
  if (!byDay || byDay.length === 0) return '';
  const map = new Map(byDay.map((d) => [d.date, d.count]));
  const days = [];
  let cur = new Date(byDay[0].date + 'T00:00:00');
  const end = new Date(byDay[byDay.length - 1].date + 'T00:00:00');
  while (cur <= end) {
    const key = cur.toLocaleDateString('sv-SE');
    days.push({ date: key, count: map.get(key) || 0 });
    cur = new Date(cur.getTime() + 86400000);
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  const step = w / days.length;
  const bw = Math.max(4, Math.min(26, step - 6));
  const chartH = h - 22;
  let bars = '';
  let labels = '';
  days.forEach((d, i) => {
    const bh = Math.round((d.count / max) * chartH);
    const x = (i * step + (step - bw) / 2).toFixed(1);
    const y = chartH - bh;
    bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="2" fill="var(--primary)"><title>${d.date}: ${d.count}</title></rect>`;
    if (d.count > 0 && bh > 0 && bh > 12) {
      bars += `<text x="${(i * step + step / 2).toFixed(1)}" y="${y - 4}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.count}</text>`;
    }
    if (days.length <= 8 || i % Math.ceil(days.length / 6) === 0) {
      labels += `<text x="${(i * step + step / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.date.slice(8, 10)}.${d.date.slice(5, 7)}</text>`;
    }
  });
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Ответы по дням">${bars}${labels}</svg>`;
}

// Сравнение классов: для каждого варианта — горизонтальный стек по классам.
function stackedBarsSvg(question, classes) {
  if (!classes.length) return '';
  const clsColors = {};
  classes.forEach((c, i) => { clsColors[c.id] = CHART_COLORS[i % CHART_COLORS.length]; });
  const rows = (question.options || []).map((o) => ({
    label: o.text,
    segs: classes.map((c) => ({ c, n: o.counts[c.id] || 0 })).filter((s) => s.n > 0)
  }));
  const max = Math.max(1, ...rows.map((r) => r.segs.reduce((a, s) => a + s.n, 0)));
  const W = 640, rowH = 30, labelW = 200, barW = W - labelW - 60;
  const H = rows.length * rowH + 26;
  let out = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Сравнение классов">`;
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    const total = r.segs.reduce((a, s) => a + s.n, 0);
    out += `<text x="${labelW - 8}" y="${y + 14}" text-anchor="end" font-size="12" fill="var(--text)">${esc(r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label)}${total ? '' : ''}</text>`;
    let x = labelW;
    r.segs.forEach((s) => {
      const wSeg = (s.n / max) * barW;
      out += `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, wSeg).toFixed(1)}" height="18" rx="3" fill="${clsColors[s.c.id]}"><title>${esc(s.c.name)}: ${s.n}</title></rect>`;
      x += wSeg;
    });
    if (total) out += `<text x="${(labelW + barW + 8).toFixed(1)}" y="${y + 14}" font-size="12" fill="var(--muted)">${total}</text>`;
  });
  const legend = classes.map((c, i) =>
    `<span class="legend-item"><span class="swatch" style="background:${clsColors[c.id]}"></span>${esc(c.name)}</span>`).join('');
  return `<div class="chart-legend">${legend}</div>${out}</svg>`;
}

let currentRole = null;
let schoolName = 'Школа № 197';

async function ensureStaff() {
  try {
    const d = await api('GET', '/api/admin/me');
    currentRole = d.authed ? (d.role || 'admin') : null;
    if (d.school_name) schoolName = d.school_name;
    return currentRole;
  } catch {
    return null;
  }
}

// Состояние опроса на клиенте (для бейджей в админке).
function clientState(s) {
  if (!s.published) return 'draft';
  const parse = (x) => (x ? new Date(String(x).replace(' ', 'T')) : null);
  const now = new Date();
  const o = parse(s.open_at);
  const c = parse(s.close_at);
  if (o && now < o) return 'scheduled';
  if (c && now >= c) return 'closed';
  return 'open';
}

/* ================= админ: каркас ================= */

function adminShell(title, active, contentHtml, extraNav = '') {
  const roleLabel = currentRole === 'admin' ? 'Администратор' : 'Редактор';
  const link = (href, label, key, ic) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`;
  return `
    <header class="app-header no-print">
      <div class="inner">
        <button class="menu-btn" id="menuBtn" aria-label="Меню">☰</button>
        <div class="brand"><img src="/img/logo.jpg" class="brand-logo" alt="">&nbsp;${esc(schoolName)}</div>
        <span class="role-badge">${roleLabel}</span>
      </div>
    </header>
    <div class="admin-layout">
      <aside class="sidebar no-print" id="sidebar">
        <nav>
          ${link('#/admin', 'Обзор', 'dashboard', 'dashboard')}
          ${link('#/admin/surveys', 'Опросы', 'surveys', 'surveys')}
          ${link('#/admin/classes', 'Классы', 'classes', 'classes')}
          ${currentRole === 'admin' ? link('#/admin/settings', 'Настройки', 'settings', 'settings') : ''}
          <a href="#" data-action="logout">${icon('logout')}<span>Выйти</span></a>
        </nav>
      </aside>
      <main class="admin-main">
        <h1>${esc(title)}</h1>
        ${contentHtml}
      </main>
    </div>`;
}

function renderAdminLogin(app) {
  setTitle('Вход');
  app.innerHTML = `
    <div class="container">
      <div class="card" style="max-width:400px;margin:36px auto">
        <div class="center">
          <img src="/img/logo.jpg" class="hero-logo" style="height:64px;width:64px" alt="Логотип">
          <h2 style="margin-top:8px">${esc(schoolName)}</h2>
          <p class="small muted">Вход для администратора и редактора</p>
        </div>
        <div id="loginErr"></div>
        <div class="field"><label>Пароль</label><input id="pw" type="password" autocomplete="current-password"></div>
        <button class="btn block" id="loginBtn">Войти</button>
      </div>
      <p class="center small muted"><a href="#/">← На главную (опросы)</a></p>
    </div>`;
  const doLogin = async () => {
    const btn = document.getElementById('loginBtn');
    const err = document.getElementById('loginErr');
    try {
      btn.disabled = true;
      btn.textContent = 'Входим…';
      await api('POST', '/api/admin/login', { password: document.getElementById('pw').value });
      // Если хэш уже целевой, hashchange не сработает — перерисовываем вручную.
      if (location.hash === '#/admin') route();
      else location.hash = '#/admin';
    } catch (e) {
      err.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  };
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

/* ================= респондент ================= */

async function viewHome(app) {
  setTitle(null);
  const data = await api('GET', '/api/bootstrap');
  if (data.school_name) schoolName = data.school_name;
  const surveys = data.surveys || [];
  let cards;
  if (!surveys.length) {
    cards = `<div class="empty"><div class="big">📋</div>Сейчас нет активных опросов.<br>Загляните позже.</div>`;
  } else {
    cards = surveys.map((s) => {
      if (s.state === 'open') {
        const est = Math.max(1, Math.round((s.questions_count || 1) * 0.4));
        const qc = `${s.questions_count} ${plural(s.questions_count, 'вопрос', 'вопроса', 'вопросов')}`;
        const until = s.close_at ? ` · до ${fmtDateShort(s.close_at)}` : '';
        return `<a class="survey-card open" href="#/login/${s.id}">
          <div class="sc-title">${esc(s.title)}</div>
          ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
          <div class="sc-meta">${icon('chart', 14)} ${qc} · ~${est} мин${until}</div>
          <div class="sc-foot"><span></span><span class="sc-btn">Пройти опрос</span></div>
        </a>`;
      }
      const badge = s.state === 'scheduled'
        ? '<span class="badge scheduled">Скоро откроется</span>'
        : '<span class="badge closed">Завершён</span>';
      return `<div class="survey-card dim">
        <div class="sc-title">${esc(s.title)}</div>
        ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
        <div class="sc-foot">${badge}</div>
      </div>`;
    }).join('');
  }
  app.innerHTML = `
    <div class="container">
      <div class="hero-compact">
        <img src="/img/logo.jpg" class="hero-logo" alt="Логотип">
        <div class="hero-text">
          <h1>${esc(schoolName)}</h1>
          <p class="muted">Выберите опрос, укажите имя, фамилию и класс — и ответьте на вопросы.</p>
        </div>
      </div>
      <img src="/img/photo.jpg" class="hero-photo" alt="Фото школы">
      <div class="cards-grid">${cards}</div>
      <p class="center small muted"><a href="#/admin">Вход для администратора и редактора</a></p>
    </div>`;
}

async function viewLogin(app, id) {
  const data = await api('GET', '/api/bootstrap');
  const survey = (data.surveys || []).find((s) => s.id === Number(id));
  if (!survey) {
    setTitle('Опрос не найден');
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Опрос не найден или не опубликован.</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }
  setTitle(survey.title);
  if (data.classes.length === 0) {
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Список классов ещё не настроен. Обратитесь к администратору.</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }
  const options = data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  app.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="center" style="margin-bottom:8px"><img src="/img/logo.jpg" class="hero-logo" style="height:52px;width:52px" alt=""></div>
        <h1>${esc(survey.title)}</h1>
        ${survey.description ? `<p class="muted">${esc(survey.description)}</p>` : ''}
        <p class="small muted">Для участия обязательно укажите имя, фамилию и класс.</p>
        <div id="loginError"></div>
        <div class="field"><label>Имя</label><input id="fname" type="text" autocomplete="given-name" placeholder="Иван"></div>
        <div class="field"><label>Фамилия</label><input id="lname" type="text" autocomplete="family-name" placeholder="Иванов"></div>
        <div class="field"><label>Класс</label><select id="cls"><option value="">— выберите класс —</option>${options}</select></div>
        <button class="btn block" id="startBtn">Начать опрос</button>
      </div>
      <p class="center small muted"><a href="#/">← На главную</a></p>
    </div>`;

  document.getElementById('startBtn').addEventListener('click', () => {
    const first = document.getElementById('fname').value.trim();
    const last = document.getElementById('lname').value.trim();
    const classId = document.getElementById('cls').value;
    const missing = [];
    if (!first) missing.push('имя');
    if (!last) missing.push('фамилию');
    if (!classId) missing.push('класс');
    if (missing.length) {
      document.getElementById('loginError').innerHTML =
        `<div class="error-banner">Необходимо указать: ${missing.map(esc).join(', ')}.</div>`;
      return;
    }
    sessionStorage.setItem(`resp_${id}`, JSON.stringify({ first_name: first, last_name: last, class_id: Number(classId) }));
    location.hash = `#/survey/${id}`;
  });
}

/* ----- прохождение опроса ----- */

function isAnswered(q, a) {
  if (!a) return false;
  if (q.type === 'text') return !!(a.text || '').trim();
  if (q.type === 'scale') return a.scale != null;
  return (a.option_ids || []).length > 0;
}

function loadSavedAnswers(id) {
  try {
    return JSON.parse(sessionStorage.getItem(`ans_${id}`) || '{}') || {};
  } catch {
    return {};
  }
}

function saveAnswersToStorage(id, answers) {
  try { sessionStorage.setItem(`ans_${id}`, JSON.stringify(answers)); } catch { /* переполнение — не критично */ }
}

// Экран прохождения опроса учеником.
async function viewSurvey(app, id) {
  const resp = JSON.parse(sessionStorage.getItem(`resp_${id}`) || 'null');
  if (!resp) { location.hash = `#/login/${id}`; return; }
  let survey;
  try {
    survey = await api('GET', `/api/survey/${id}`);
  } catch (e) {
    setTitle('Опрос недоступен');
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">${esc(e.message)}</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }
  setTitle(survey.title);
  const total = survey.questions.length;
  let idx = 0;
  const answers = loadSavedAnswers(id);
  const hasRequired = survey.questions.some((q) => q.required);

  function fillProgress() {
    const done = survey.questions.filter((q) => isAnswered(q, answers[q.id])).length;
    const fill = document.getElementById('progFill');
    const meta = document.getElementById('progMeta');
    if (fill) fill.style.width = Math.round((done / total) * 100) + '%';
    if (meta) meta.textContent = `Вопрос ${idx + 1} из ${total}`;
  }

  function validateCurrent(q) {
    if (!q.required) return true;
    return isAnswered(q, answers[q.id]);
  }

  function currentHint(q) {
    if (q.type === 'single') return 'Выберите один вариант';
    if (q.type === 'multiple') return 'Выберите хотя бы один вариант';
    if (q.type === 'scale') return `Поставьте оценку от 1 до ${q.scale_max || 5}`;
    return 'Введите ответ';
  }

  function persist() {
    saveAnswersToStorage(id, answers);
  }

  function renderQuestion() {
    const q = survey.questions[idx];
    if (!answers[q.id]) answers[q.id] = { option_ids: [], text: '', scale: null };
    const a = answers[q.id];
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let body;
    if (q.type === 'text') {
      body = `<textarea id="kText" placeholder="Ваш ответ">${esc(a.text)}</textarea>`;
    } else if (q.type === 'scale') {
      const max = q.scale_max || 5;
      body = `<div class="scale-row">${Array.from({ length: max }, (_, i) => i + 1)
        .map((v) => `<button type="button" class="scale-btn ${a.scale === v ? 'selected' : ''}" data-scale="${v}">${v}</button>`)
        .join('')}</div>
        <div class="scale-hint"><span>1 — плохо</span><span>${max} — отлично</span></div>`;
    } else {
      body = q.options.map((o) => {
        const checked = (a.option_ids || []).includes(o.id);
        return `<label class="option ${checked ? 'selected' : ''}">
          <input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="q${q.id}" value="${o.id}" ${checked ? 'checked' : ''}>
          <span class="opt-text">${esc(o.text)}</span>
        </label>`;
      }).join('');
    }
    const hint = q.type === 'single' ? 'Выберите один вариант'
      : q.type === 'multiple' ? 'Можно выбрать несколько вариантов'
        : q.type === 'scale' ? `Оцените от 1 до ${q.scale_max || 5}`
          : '';
    app.innerHTML = `
      <div class="container kiosk">
        <div class="progress-wrap">
          <div class="progress-meta"><span id="progMeta"></span><span>${esc(resp.first_name)} ${esc(resp.last_name)}</span></div>
          <div class="progress-track"><div class="progress-fill" id="progFill" style="width:0%"></div></div>
        </div>
        <div class="question-card">
          <div class="q-text">${idx + 1}. ${esc(q.text)}${req}</div>
          ${hint ? `<div class="q-hint">${hint}</div>` : ''}
          ${body}
        </div>
        <div id="surveyErr"></div>
        <div class="kiosk-nav">
          ${idx > 0 ? '<button class="btn ghost" id="prevBtn">← Назад</button>' : '<span></span>'}
          ${idx < total - 1 ? '<button class="btn" id="nextBtn">Далее →</button>' : '<button class="btn" id="submitBtn">Отправить ответы</button>'}
        </div>
        ${hasRequired ? '<div class="req-note no-print">* — обязательный вопрос</div>' : ''}
      </div>`;
    fillProgress();

    app.querySelectorAll('.option input').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (q.type === 'single') {
          a.option_ids = [Number(inp.value)];
          app.querySelectorAll('.option').forEach((o) => o.classList.remove('selected'));
          inp.closest('.option').classList.add('selected');
        } else {
          a.option_ids = [...app.querySelectorAll(`input[name="q${q.id}"]:checked`)].map((i) => Number(i.value));
          inp.closest('.option').classList.toggle('selected', inp.checked);
        }
        persist();
        fillProgress();
      });
    });
    const ta = document.getElementById('kText');
    if (ta) ta.addEventListener('input', () => { a.text = ta.value; persist(); fillProgress(); });

    app.querySelectorAll('.scale-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        a.scale = Number(btn.dataset.scale);
        app.querySelectorAll('.scale-btn').forEach((b) => b.classList.toggle('selected', Number(b.dataset.scale) === a.scale));
        persist();
        fillProgress();
      });
    });

    const showErr = (m) => { document.getElementById('surveyErr').innerHTML = `<div class="error-banner">${esc(m)}</div>`; };

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (!validateCurrent(q)) { showErr(currentHint(q)); return; }
      idx += 1; renderQuestion(); window.scrollTo({ top: 0 });
    });
    const prevBtn = document.getElementById('prevBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { idx -= 1; renderQuestion(); window.scrollTo({ top: 0 }); });

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      if (!validateCurrent(q)) { showErr(currentHint(q)); return; }
      const payload = survey.questions.map((qq) => {
        const aa = answers[qq.id] || { option_ids: [], text: '', scale: null };
        if (qq.type === 'text') return { question_id: qq.id, text: aa.text || '' };
        if (qq.type === 'scale') return { question_id: qq.id, scale: aa.scale };
        return { question_id: qq.id, option_ids: aa.option_ids || [] };
      });
      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка…';
        await api('POST', `/api/survey/${id}/submit`, {
          first_name: resp.first_name,
          last_name: resp.last_name,
          class_id: resp.class_id,
          answers: payload
        });
        sessionStorage.setItem(`done_${id}`, '1');
        sessionStorage.removeItem(`resp_${id}`);
        sessionStorage.removeItem(`ans_${id}`);
        location.hash = '#/done';
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить ответы';
        showErr(e.message);
        if (/уже проходили|уже отправлен|завершён|не начался/.test(e.message)) {
          sessionStorage.setItem(`done_${id}`, '1');
          sessionStorage.removeItem(`resp_${id}`);
          sessionStorage.removeItem(`ans_${id}`);
          setTimeout(() => { location.hash = '#/done'; }, 1600);
        }
      }
    });
  }

  renderQuestion();
}

function viewDone(app) {
  setTitle('Спасибо');
  app.innerHTML = `
    <div class="container">
      <div class="card center" style="padding:36px 18px">
        <div style="font-size:52px">✅</div>
        <h1>Спасибо!</h1>
        <p class="muted">Ваши ответы сохранены.</p>
        <a class="btn" href="#/">На главную</a>
      </div>
    </div>`;
}

/* ================= админ: дашборд ================= */

async function viewDashboard(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  setTitle('Обзор');
  const d = await api('GET', '/api/admin/dashboard');
  const stateBadge = (st) => st === 'open' ? '<span class="badge published">Идёт</span>'
    : st === 'scheduled' ? '<span class="badge scheduled">Скоро</span>'
      : st === 'closed' ? '<span class="badge closed">Завершён</span>'
        : '<span class="badge draft">Черновик</span>';
  const top = d.top.length ? d.top.map((s) => `
    <div class="list-item">
      <div class="grow"><a href="#/admin/report/${s.id}"><div class="title">${esc(s.title)}</div></a></div>
      ${stateBadge(s.state)}
      <span class="muted small">${s.responses_count} ${plural(s.responses_count, 'ответ', 'ответа', 'ответов')}</span>
    </div>`).join('') : '<div class="empty">Опросов пока нет.</div>';

  app.innerHTML = adminShell('Обзор', 'dashboard', `
    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-num">${d.active_surveys}</div><div class="stat-label">идут сейчас</div></div>
      <div class="stat-tile"><div class="stat-num">${d.scheduled_surveys}</div><div class="stat-label">скоро откроются</div></div>
      <div class="stat-tile"><div class="stat-num">${d.responses_week}</div><div class="stat-label">ответов за неделю</div></div>
      <div class="stat-tile"><div class="stat-num">${d.responses_total}</div><div class="stat-label">ответов всего</div></div>
    </div>
    <div class="card">
      <h2>Активность за 14 дней</h2>
      ${byDaySvg(d.by_day)}
    </div>
    <div class="card">
      <h2>Опросы</h2>
      ${top}
      <div class="btn-row" style="margin-top:12px"><a class="btn soft" href="#/admin/surveys">Все опросы (${d.total_surveys})</a></div>
    </div>`);
}

/* ================= админ: опросы ================= */

async function viewAdminSurveys(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  setTitle('Опросы');
  const data = await api('GET', '/api/admin/surveys');
  const surveys = data.surveys;
  const cards = surveys.length ? surveys.map((s) => {
    const st = clientState(s);
    let badge = st === 'draft' ? '<span class="badge draft">Черновик</span>'
      : st === 'scheduled' ? '<span class="badge scheduled">Скоро</span>'
        : st === 'closed' ? '<span class="badge closed">Завершён</span>'
          : '<span class="badge published">Опубликован</span>';
    // Индикатор «скоро закроется»
    if (st === 'open' && s.close_at) {
      const days = daysUntil(s.close_at);
      if (days != null && days <= 3) {
        badge += ` <span class="badge closing">Закроется ${days < 0 ? 'уже' : 'через ' + days + ' ' + plural(days, 'день', 'дня', 'дней')}</span>`;
      }
    }
    let meta = `Вопросов: ${s.questions_count} · Ответов: ${s.responses_count}`;
    if (s.published_at) meta += `<br>Опубликован: ${fmtDb(s.published_at)}`;
    if (s.open_at) meta += `<br>Открытие: ${fmtWall(s.open_at)}`;
    if (s.close_at) meta += `<br>Закрытие: ${fmtWall(s.close_at)}`;
    return `<div class="survey-card">
      <div class="sc-title">${esc(s.title)}</div>
      ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
      <div class="sub">${badge} ${meta}</div>
      <div class="btn-row">
        <a class="btn small soft" href="#/admin/report/${s.id}">Отчёт</a>
        <a class="btn small ghost" href="#/admin/survey/${s.id}">Изменить</a>
        <button class="btn small ${s.published ? 'ghost' : 'soft'}" data-toggle="${s.id}" data-pub="${s.published ? 0 : 1}">${s.published ? 'Снять' : `Опубликовать · ${s.questions_count}`}</button>
      </div>
      <div class="icon-row">
        ${s.published ? `<button class="icon-btn" data-share="${s.id}" data-title="${esc(s.title)}" title="Ссылка и QR-код">${icon('qr')}</button>` : ''}
        <button class="icon-btn" data-dup="${s.id}" title="Создать копию">${icon('copy')}</button>
        <button class="icon-btn danger" data-del="${s.id}" data-title="${esc(s.title)}" title="Удалить опрос">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><div class="big">📝</div>Пока нет опросов. Нажмите «Новый опрос», чтобы создать.</div>`;

  app.innerHTML = adminShell('Опросы', 'surveys', `
    <div class="btn-row no-print" style="margin-bottom:14px"><a class="btn" href="#/admin/survey/new">${icon('plus')} Новый опрос</a></div>
    <div class="cards-grid">${cards}</div>`);

  app.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api('POST', `/api/admin/surveys/${b.dataset.toggle}/publish`, { published: b.dataset.pub === '1' });
        viewAdminSurveys(app);
      } catch (e) { toast(e.message, 6000); }
    });
  });
  app.querySelectorAll('[data-share]').forEach((b) => {
    b.addEventListener('click', () => showShareModal(b.dataset.share, b.dataset.title));
  });
  app.querySelectorAll('[data-dup]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api('POST', `/api/admin/surveys/${b.dataset.dup}/duplicate`);
        toast('Копия создана (черновик)');
        viewAdminSurveys(app);
      } catch (e) { toast(e.message, 6000); b.disabled = false; }
    });
  });
  app.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await uiConfirm({
        title: 'Удалить опрос?',
        message: `«${b.dataset.title}» будет удалён вместе со всеми ответами. Действие необратимо.`
      });
      if (!ok) return;
      try {
        await api('DELETE', `/api/admin/surveys/${b.dataset.del}`);
        toast('Опрос удалён');
        viewAdminSurveys(app);
      } catch (e) { toast(e.message, 6000); }
    });
  });
}

/* ----- редактор опроса ----- */

let ES = null;

function newQuestion(type) {
  return { text: '', type: type || 'single', required: true, scale_max: 5, options: type === 'text' || type === 'scale' ? [] : ['', ''] };
}

function questionHtml(q, i, total) {
  const optArea = (q.type === 'text' || q.type === 'scale') ? '' : `
    <div data-optarea="${i}" style="margin-bottom:10px">
      ${q.options.map((o, oi) => `
        <div class="option-edit-row">
          <button type="button" class="icon-btn tiny" data-optup="${i}" data-oi="${oi}" title="Выше" ${oi === 0 ? 'disabled' : ''}>${icon('up', 14)}</button>
          <button type="button" class="icon-btn tiny" data-optdown="${i}" data-oi="${oi}" title="Ниже" ${oi === q.options.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button>
          <input type="text" value="${esc(o)}" data-q="${i}" data-opt="${oi}" placeholder="Вариант ${oi + 1}">
          <button type="button" class="icon-btn danger" data-delopt="${i}" data-oi="${oi}" title="Удалить вариант">${icon('x', 15)}</button>
        </div>`).join('')}
      <button type="button" class="btn small ghost" data-addopt="${i}">${icon('plus', 14)} Вариант</button>
    </div>`;
  const scaleArea = q.type === 'scale' ? `
    <div class="field"><label>Шкала от 1 до</label>
      <select data-qscale="${i}">
        <option value="5" ${q.scale_max !== 10 ? 'selected' : ''}>5</option>
        <option value="10" ${q.scale_max === 10 ? 'selected' : ''}>10</option>
      </select>
    </div>` : '';
  return `
    <div class="editor-question">
      <div class="q-head">
        <div class="num">${i + 1}.</div>
        <div class="q-body">
          <div class="q-tools">
            <button type="button" class="icon-btn tiny" data-qup="${i}" title="Выше" ${i === 0 ? 'disabled' : ''}>${icon('up', 14)}</button>
            <button type="button" class="icon-btn tiny" data-qdown="${i}" title="Ниже" ${i === total - 1 ? 'disabled' : ''}>${icon('down', 14)}</button>
          </div>
          <div class="field"><input type="text" value="${esc(q.text)}" data-qtext="${i}" placeholder="Текст вопроса"></div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
            <select data-qtype="${i}" style="flex:1;min-width:180px">
              <option value="single" ${q.type === 'single' ? 'selected' : ''}>Один вариант</option>
              <option value="multiple" ${q.type === 'multiple' ? 'selected' : ''}>Несколько вариантов</option>
              <option value="scale" ${q.type === 'scale' ? 'selected' : ''}>Шкала (оценка)</option>
              <option value="text" ${q.type === 'text' ? 'selected' : ''}>Свободный ответ</option>
            </select>
            <label class="check"><input type="checkbox" data-qreq="${i}" ${q.required ? 'checked' : ''}> Обязательный</label>
          </div>
          ${scaleArea}
          ${optArea}
          <button type="button" class="btn small danger ghost" data-delq="${i}">Удалить вопрос</button>
        </div>
      </div>
    </div>`;
}

// Загрузка опроса в ES с сервера (или новый черновик).
async function loadEditorState(id) {
  let existing = null;
  if (id) {
    existing = (await api('GET', `/api/admin/surveys/${id}`)).survey;
  }
  ES = {
    id: id || null,
    title: existing ? existing.title : '',
    description: existing ? existing.description : '',
    open_at: existing ? existing.open_at : null,
    close_at: existing ? existing.close_at : null,
    questions: existing
      ? existing.questions.map((q) => ({
        text: q.text, type: q.type, required: !!q.required,
        scale_max: q.scale_max || 5, options: q.options.map((o) => o.text)
      }))
      : [newQuestion()],
    dirty: false,
    saving: false,
    lastSavedAt: null
  };
}

let editorUnloadHandler = null;

async function viewEditor(app, id, opts = {}) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  setTitle(id ? 'Редактирование опроса' : 'Новый опрос');
  if (!opts.reuseState) await loadEditorState(id);

  app.innerHTML = adminShell(id ? 'Редактирование опроса' : 'Новый опрос', 'surveys', `
    <div class="editor-status no-print" id="editorStatus"></div>
    <div id="editorErr"></div>
    <div class="card">
      <div class="field"><label>Название опроса</label><input id="svTitle" type="text" value="${esc(ES.title)}" placeholder="Например: Опрос об организации питания"></div>
      <div class="field"><label>Описание (необязательно)</label><textarea id="svDesc" placeholder="Краткое описание для участников">${esc(ES.description)}</textarea></div>
    </div>
    <div class="card">
      <h2>Расписание публикации <span class="small muted">(необязательно)</span></h2>
      <p class="small muted">Оставьте пустым, чтобы опрос был доступен сразу после публикации и без ограничения по времени.</p>
      <div class="schedule-row">
        <div class="field"><label>Открыть с</label><input type="datetime-local" id="svOpen" value="${ES.open_at ? esc(String(ES.open_at).replace(' ', 'T')) : ''}"></div>
        <div class="field"><label>Закрыть до</label><input type="datetime-local" id="svClose" value="${ES.close_at ? esc(String(ES.close_at).replace(' ', 'T')) : ''}"></div>
      </div>
    </div>
    <div id="questions"></div>
    <button type="button" class="btn ghost block no-print" id="addQ">${icon('plus')} Добавить вопрос</button>
    <div class="btn-row no-print" style="margin-top:16px">
      <button class="btn" id="saveBtn">Сохранить</button>
      <button class="btn soft" id="previewBtn">${icon('eye')} Предпросмотр</button>
      <a class="btn ghost" href="#/admin/surveys">К списку</a>
      ${ES.id ? `<button class="btn danger ghost" id="delBtn">${icon('trash')} Удалить</button>` : ''}
    </div>`);

  function markDirty() { ES.dirty = true; refreshStatus(); }
  function refreshStatus() {
    const el = document.getElementById('editorStatus');
    if (!el) return;
    if (ES.saving) el.textContent = 'Сохранение…';
    else if (ES.dirty) el.textContent = 'Есть несохранённые изменения (автосохранение каждые 30 секунд)';
    else if (ES.lastSavedAt) el.textContent = `Черновик сохранён в ${ES.lastSavedAt}`;
    else el.textContent = '';
  }

  document.getElementById('svTitle').addEventListener('input', (e) => { ES.title = e.target.value; markDirty(); });
  document.getElementById('svDesc').addEventListener('input', (e) => { ES.description = e.target.value; markDirty(); });
  document.getElementById('svOpen').addEventListener('input', (e) => { ES.open_at = e.target.value || null; markDirty(); });
  document.getElementById('svClose').addEventListener('input', (e) => { ES.close_at = e.target.value || null; markDirty(); });

  const qCont = document.getElementById('questions');
  function drawQuestions() { qCont.innerHTML = ES.questions.map((q, i) => questionHtml(q, i, ES.questions.length)).join(''); }
  drawQuestions();

  qCont.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.qtext != null) { ES.questions[+t.dataset.qtext].text = t.value; markDirty(); }
    else if (t.dataset.opt != null && t.dataset.q != null) { ES.questions[+t.dataset.q].options[+t.dataset.opt] = t.value; markDirty(); }
  });
  qCont.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.qreq != null) { ES.questions[+t.dataset.qreq].required = t.checked; markDirty(); }
    else if (t.dataset.qscale != null) { ES.questions[+t.dataset.qscale].scale_max = Number(t.value); markDirty(); }
    else if (t.dataset.qtype != null) {
      const q = ES.questions[+t.dataset.qtype];
      const newType = t.value;
      const filledOpts = (q.options || []).filter((o) => String(o).trim()).length;
      const losesData = (q.type === 'single' || q.type === 'multiple') && (newType === 'text' || newType === 'scale') && filledOpts > 0;
      if (losesData) {
        const ok = await uiConfirm({
          title: 'Сменить тип вопроса?',
          message: 'Введённые варианты ответа будут удалены.',
          okLabel: 'Сменить тип',
          danger: true
        });
        if (!ok) {
          t.value = q.type;
          return;
        }
      }
      q.type = newType;
      if (newType === 'text' || newType === 'scale') q.options = [];
      else if (q.options.length === 0) q.options = ['', ''];
      markDirty();
      drawQuestions();
    }
  });
  qCont.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.addopt != null) { ES.questions[+btn.dataset.addopt].options.push(''); markDirty(); drawQuestions(); }
    else if (btn.dataset.delopt != null) { ES.questions[+btn.dataset.delopt].options.splice(+btn.dataset.oi, 1); markDirty(); drawQuestions(); }
    else if (btn.dataset.optup != null) {
      const opts = ES.questions[+btn.dataset.optup].options;
      const oi = +btn.dataset.oi;
      [opts[oi - 1], opts[oi]] = [opts[oi], opts[oi - 1]];
      markDirty(); drawQuestions();
    }
    else if (btn.dataset.optdown != null) {
      const opts = ES.questions[+btn.dataset.optdown].options;
      const oi = +btn.dataset.oi;
      [opts[oi], opts[oi + 1]] = [opts[oi + 1], opts[oi]];
      markDirty(); drawQuestions();
    }
    else if (btn.dataset.qup != null) {
      const i = +btn.dataset.qup;
      [ES.questions[i - 1], ES.questions[i]] = [ES.questions[i], ES.questions[i - 1]];
      markDirty(); drawQuestions();
    }
    else if (btn.dataset.qdown != null) {
      const i = +btn.dataset.qdown;
      [ES.questions[i], ES.questions[i + 1]] = [ES.questions[i + 1], ES.questions[i]];
      markDirty(); drawQuestions();
    }
    else if (btn.dataset.delq != null) {
      ES.questions.splice(+btn.dataset.delq, 1);
      if (ES.questions.length === 0) ES.questions.push(newQuestion());
      markDirty(); drawQuestions();
    }
  });

  document.getElementById('addQ').addEventListener('click', () => { ES.questions.push(newQuestion()); markDirty(); drawQuestions(); });

  // Сохранение черновика. silent — автосохранение (без перехода и тоста).
  async function saveDraft(silent) {
    const payload = { title: ES.title, description: ES.description, questions: ES.questions, open_at: ES.open_at, close_at: ES.close_at };
    const wasNew = !ES.id;
    ES.saving = true;
    refreshStatus();
    try {
      let saved;
      if (ES.id) saved = (await api('PUT', `/api/admin/surveys/${ES.id}`, payload)).survey;
      else saved = (await api('POST', '/api/admin/surveys', payload)).survey;
      ES.id = saved.id;
      ES.dirty = false;
      ES.lastSavedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      // Новый опрос после первого сохранения получил id — поправим адресную строку,
      // но только если пользователь всё ещё в редакторе.
      if (wasNew && /^#\/admin\/survey\/(new|\d+)$/.test(location.hash)) {
        history.replaceState(null, '', `#/admin/survey/${ES.id}`);
      }
      return true;
    } catch (e) {
      if (!silent) {
        document.getElementById('editorErr').innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast('Автосохранение не удалось: ' + e.message, 5000);
      }
      return false;
    } finally {
      ES.saving = false;
      refreshStatus();
    }
  }

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Сохранение…';
    const ok = await saveDraft(false);
    if (ok) {
      toast('Черновик сохранён');
      location.hash = '#/admin/surveys';
    } else {
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  });

  document.getElementById('previewBtn').addEventListener('click', () => {
    // Предпросмотр из текущего состояния редактора — без сохранения на сервер.
    const questions = ES.questions
      .filter((q) => q.text.trim())
      .map((q, i) => ({
        id: -(i + 1), // отрицательные id — только для предпросмотра
        text: q.text,
        type: q.type,
        required: q.required,
        scale_max: q.scale_max || 5,
        options: q.options.map((o, oi) => ({ id: -(i + 1) * 100 - oi, text: o }))
      }));
    if (questions.length === 0) { toast('Добавьте хотя бы один вопрос с текстом'); return; }
    renderPreview(app, { title: ES.title || 'Опрос', questions });
  });

  const delBtn = document.getElementById('delBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await uiConfirm({
      title: 'Удалить опрос?',
      message: `«${ES.title || 'Без названия'}» будет удалён вместе со всеми ответами. Действие необратимо.`
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/surveys/${ES.id}`);
      toast('Опрос удалён');
      location.hash = '#/admin/surveys';
    } catch (e) { toast(e.message, 6000); }
  });

  // Автосохранение раз в 30 секунд и предупреждение при уходе.
  const autosaveTimer = setInterval(() => {
    if (ES && ES.dirty && !ES.saving && ES.title.trim()) saveDraft(true);
  }, 30000);
  if (editorUnloadHandler) {
    window.removeEventListener('beforeunload', editorUnloadHandler);
    clearInterval(editorUnloadHandler._timer);
  }
  editorUnloadHandler = (e) => {
    if (ES && ES.dirty) { e.preventDefault(); e.returnValue = ''; }
  };
  editorUnloadHandler._timer = autosaveTimer;
  window.addEventListener('beforeunload', editorUnloadHandler);

  refreshStatus();
}

// Предпросмотр опроса глазами ученика (данные из редактора, ответы не сохраняются).
function renderPreview(app, survey) {
  setTitle(`Предпросмотр: ${survey.title}`);
  const resp = { first_name: 'Предпросмотр', last_name: '', class_id: null };
  const total = survey.questions.length;
  let idx = 0;
  const answers = {};
  const hasRequired = survey.questions.some((q) => q.required);

  function renderQuestion() {
    const q = survey.questions[idx];
    if (!answers[q.id]) answers[q.id] = { option_ids: [], text: '', scale: null };
    const a = answers[q.id];
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let body;
    if (q.type === 'text') {
      body = `<textarea id="kText" placeholder="Ваш ответ"></textarea>`;
    } else if (q.type === 'scale') {
      const max = q.scale_max || 5;
      body = `<div class="scale-row">${Array.from({ length: max }, (_, i) => i + 1)
        .map((v) => `<button type="button" class="scale-btn" data-scale="${v}">${v}</button>`).join('')}</div>
        <div class="scale-hint"><span>1 — плохо</span><span>${max} — отлично</span></div>`;
    } else {
      body = q.options.map((o) => `
        <label class="option">
          <input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="q${q.id}" value="${o.id}">
          <span class="opt-text">${esc(o.text)}</span>
        </label>`).join('');
    }
    app.innerHTML = `
      <div class="container kiosk">
        <div class="preview-banner no-print">🔍 Предпросмотр — ответы не сохраняются</div>
        <div class="progress-wrap">
          <div class="progress-meta"><span>Вопрос ${idx + 1} из ${total}</span><span>${esc(resp.first_name)}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.round((idx / total) * 100)}%"></div></div>
        </div>
        <div class="question-card">
          <div class="q-text">${idx + 1}. ${esc(q.text)}${req}</div>
          ${body}
        </div>
        <div id="surveyErr"></div>
        <div class="kiosk-nav">
          ${idx > 0 ? '<button class="btn ghost" id="prevBtn">← Назад</button>' : '<span></span>'}
          ${idx < total - 1 ? '<button class="btn" id="nextBtn">Далее →</button>' : '<button class="btn" id="finishBtn">Завершить предпросмотр</button>'}
        </div>
        ${hasRequired ? '<div class="req-note no-print">* — обязательный вопрос</div>' : ''}
      </div>`;

    const q2 = survey.questions[idx];
    if (q2.type === 'scale') {
      app.querySelectorAll('.scale-btn').forEach((btn) => btn.addEventListener('click', () => {
        answers[q2.id].scale = Number(btn.dataset.scale);
        app.querySelectorAll('.scale-btn').forEach((b) => b.classList.toggle('selected', b === btn));
      }));
    } else if (q2.type !== 'text') {
      app.querySelectorAll('.option input').forEach((inp) => inp.addEventListener('change', () => {
        inp.closest('.option').classList.toggle('selected', inp.checked);
      }));
    }
    const prev = document.getElementById('prevBtn');
    if (prev) prev.addEventListener('click', () => { idx -= 1; renderQuestion(); });
    const next = document.getElementById('nextBtn');
    if (next) next.addEventListener('click', () => { idx += 1; renderQuestion(); });
    const fin = document.getElementById('finishBtn');
    if (fin) fin.addEventListener('click', () => {
      toast('Предпросмотр завершён');
      location.hash = ES && ES.id ? `#/admin/survey/${ES.id}` : '#/admin/survey/new';
    });
  }
  renderQuestion();
}

/* ----- классы ----- */

async function viewClasses(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  setTitle('Классы');
  const data = await api('GET', '/api/admin/classes');
  const classes = data.classes;
  const list = classes.length ? classes.map((c) => `
    <div class="list-item" data-row="${c.id}">
      <div class="grow">
        <div class="title" data-name="${c.id}">${esc(c.name)}</div>
        <div class="sub">${c.responses_count} ${plural(c.responses_count, 'ответ', 'ответа', 'ответов')}</div>
      </div>
      <button class="icon-btn" data-rename="${c.id}" title="Переименовать">${icon('pencil', 16)}</button>
      <button class="icon-btn danger" data-del="${c.id}" data-title="${esc(c.name)}" title="Удалить класс">${icon('trash', 16)}</button>
    </div>`).join('') : `<div class="empty"><div class="big">🏫</div>Список классов пуст. Добавьте классы, например «9А», «10Б».</div>`;

  app.innerHTML = adminShell('Классы', 'classes', `
    <div class="card">
      <div class="field"><label>Добавить классы</label>
        <p class="small muted" style="margin:0 0 6px">Можно несколько через запятую: «9А, 9Б, 10А».</p>
        <div style="display:flex;gap:8px">
          <input id="newClass" type="text" placeholder="Например: 9А">
          <button class="btn" id="addClass">Добавить</button>
        </div>
      </div>
    </div>
    <div class="card">${list}</div>`);

  const add = async () => {
    const inp = document.getElementById('newClass');
    const v = inp.value.trim();
    if (!v) { toast('Введите название класса'); return; }
    const names = v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    try {
      await api('POST', '/api/admin/classes', names.length > 1 ? { names } : { name: names[0] });
      inp.value = '';
      viewClasses(app);
    } catch (e) { toast(e.message); }
  };
  document.getElementById('addClass').addEventListener('click', add);
  document.getElementById('newClass').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  app.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await uiConfirm({
        title: 'Удалить класс?',
        message: `Класс «${b.dataset.title}» будет удалён из списка. Уже сохранённые ответы сохранят его название.`
      });
      if (!ok) return;
      try { await api('DELETE', `/api/admin/classes/${b.dataset.del}`); viewClasses(app); }
      catch (e) { toast(e.message); }
    });
  });

  // Инлайн-переименование вместо prompt().
  app.querySelectorAll('[data-rename]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.rename;
      const row = app.querySelector(`[data-row="${id}"]`);
      const titleEl = row.querySelector('[data-name]');
      const old = titleEl.textContent;
      titleEl.outerHTML = `
        <div class="title inline-edit" data-name="${id}">
          <input type="text" value="${esc(old)}" data-edit-input="${id}">
          <button class="icon-btn tiny" data-save-name="${id}" title="Сохранить">${icon('check', 15)}</button>
          <button class="icon-btn tiny" data-cancel-name="${id}" title="Отмена">${icon('x', 15)}</button>
        </div>`;
      const input = row.querySelector(`[data-edit-input="${id}"]`);
      input.focus();
      input.select();
      const finish = (ok) => {
        const v = input.value.trim();
        if (!ok || !v || v === old) { viewClasses(app); return; }
        api('PUT', `/api/admin/classes/${id}`, { name: v })
          .then(() => viewClasses(app))
          .catch((e) => { toast(e.message); viewClasses(app); });
      };
      row.querySelector(`[data-save-name="${id}"]`).addEventListener('click', () => finish(true));
      row.querySelector(`[data-cancel-name="${id}"]`).addEventListener('click', () => finish(false));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
    });
  });
}

/* ----- отчёт ----- */

function donutSvg(options, total) {
  if (!total) return '';
  const r = 40, cx = 70, cy = 70;
  const C = 2 * Math.PI * r;
  let offset = 0;
  let circles = '';
  options.forEach((o, i) => {
    if (o.count <= 0) return;
    const frac = o.count / total;
    const len = frac * C;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(o.text)} — ${o.count} (${o.percent}%)</title></circle>`;
    offset += len;
  });
  return `<svg viewBox="0 0 140 140" class="donut" aria-hidden="true">${circles}<text x="${cx}" y="${cy - 8}" text-anchor="middle" dominant-baseline="central" class="donut-center">${total}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="var(--muted)">ответов</text></svg>`;
}

function avgLabel(q) {
  return q.average != null ? String(q.average).replace('.', ',') : '—';
}

function renderQuestionSection(q) {
  if (q.type === 'text') {
    const answers = q.answers.length
      ? q.answers.map((a) => `<span class="answer-chip">${esc(a.text)}${a.class ? ` <span class="muted small">(${esc(a.class)})</span>` : ''}</span>`).join('')
      : '<span class="muted">— ответов нет —</span>';
    return `<div class="report-q">
      <div class="q-title">${esc(q.text)} <span class="muted small">(свободный ответ)</span></div>
      <p class="small muted">Всего ответов: ${q.total}</p>${answers}
    </div>`;
  }
  if (q.type === 'scale') {
    const bars = q.distribution.map((d) => {
      const pct = Math.round(d.percent);
      return `<div class="bar-row">
        <div class="bar-label"><span>${icon('star', 13)} Оценка ${d.value}</span><span>${d.count} · ${pct}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--primary)"></div></div>
      </div>`;
    }).join('');
    return `<div class="report-q">
      <div class="q-title">${esc(q.text)} <span class="muted small">(шкала 1–${q.scale_max})</span></div>
      <p class="small muted">Оценили: ${q.total}</p>
      <div class="scale-avg"><span class="scale-avg-num">${avgLabel(q)}</span><span class="muted small">из ${q.scale_max} — средняя оценка</span></div>
      ${bars}
    </div>`;
  }
  const typeLabel = q.type === 'single' ? 'один вариант' : 'несколько вариантов';
  const donut = q.type === 'single' ? `<div class="chart-row">${donutSvg(q.options, q.total)}</div>` : '';
  const bars = q.options.length === 0
    ? '<span class="muted">— нет вариантов —</span>'
    : q.options.map((o, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      return `<div class="bar-row">
        <div class="bar-label"><span><span class="swatch" style="background:${color}"></span>${esc(o.text)}</span><span>${o.count} · ${o.percent}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${o.percent}%;background:${color}"></div></div>
      </div>`;
    }).join('');
  return `<div class="report-q">
    <div class="q-title">${esc(q.text)} <span class="muted small">(${typeLabel})</span></div>
    <p class="small muted">Ответило: ${q.total}</p>
    ${donut}
    ${bars}
  </div>`;
}

function renderBreakdown(d) {
  const classes = d.classes || [];
  if (!classes.length) return '<div class="empty">Ответов пока нет.</div>';
  const sections = d.questions.map((q) => {
    if (q.type === 'scale') {
      const rows = [];
      for (let v = 1; v <= (q.scale_max || 5); v++) {
        const cells = classes.map((c) => `<td>${(q.counts[c.id] || {})[v] || 0}</td>`).join('');
        rows.push(`<tr><td>Оценка ${v}</td>${cells}</tr>`);
      }
      const avgRow = `<tr class="total"><td>Средняя</td>${classes.map((c) => `<td>${q.averages[c.id] != null ? String(q.averages[c.id]).replace('.', ',') : '—'}</td>`).join('')}</tr>`;
      return `<div class="report-q">
        <div class="q-title">${esc(q.text)} <span class="muted small">(шкала 1–${q.scale_max || 5})</span></div>
        <div class="table-wrap"><table><thead><tr><th>Оценка</th>${classes.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}${avgRow}</tbody></table></div>
      </div>`;
    }
    if (q.type === 'text') {
      const cells = classes.map((c) => `<td>${q.totals[c.id] || 0}</td>`).join('');
      return `<div class="report-q">
        <div class="q-title">${esc(q.text)} <span class="muted small">(свободный ответ — количество)</span></div>
        <div class="table-wrap"><table><thead><tr><th>Класс</th>${classes.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody><tr><td>Ответов</td>${cells}</tr></tbody></table></div>
      </div>`;
    }
    const chart = stackedBarsSvg(q, classes);
    const rows = q.options.map((o) => {
      const cells = classes.map((c) => {
        const cnt = o.counts[c.id] || 0;
        const tot = q.totals[c.id] || 0;
        const pct = tot ? Math.round((cnt / tot) * 100) : 0;
        return `<td>${cnt}${tot ? ` <span class="muted small">(${pct}%)</span>` : ''}</td>`;
      }).join('');
      return `<tr><td>${esc(o.text)}</td>${cells}</tr>`;
    }).join('');
    const totalRow = `<tr class="total"><td class="muted">Ответило</td>${classes.map((c) => `<td>${q.totals[c.id] || 0}</td>`).join('')}</tr>`;
    return `<div class="report-q">
      <div class="q-title">${esc(q.text)}</div>
      ${chart}
      <div class="table-wrap"><table><thead><tr><th>Вариант</th>${classes.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows}${totalRow}</tbody></table></div>
    </div>`;
  }).join('');
  return sections;
}

function renderHistory(history) {
  if (!history.length) return '<div class="empty">История пуста.</div>';
  const items = history.map((h) => `
    <div class="history-item">
      <span>${h.action === 'publish' ? '✅ Опубликован' : '⛔ Снят с публикации'}</span>
      <span class="muted small">${h.actor === 'editor' ? 'редактор' : 'администратор'} · ${fmtDb(h.created_at)}</span>
    </div>`).join('');
  return `<div class="history-list">${items}</div>`;
}

// Индивидуальные ответы: поиск + постраничная навигация.
function renderIndividual(d) {
  if (d.responses.length === 0) return '<div class="empty">Ответов пока нет.</div>';
  const qs = d.survey.questions;
  const PAGE = 25;
  let page = 0;
  let query = '';
  let filtered = d.responses;

  function applyFilter() {
    const q = query.trim().toLowerCase();
    filtered = !q ? d.responses : d.responses.filter((r) => {
      if ((r.class || '').toLowerCase().includes(q)) return true;
      return r.answers.some((a) => String(a.option_text || a.text_value || '').toLowerCase().includes(q));
    });
    if (page >= pages()) page = 0;
  }
  function pages() { return Math.max(1, Math.ceil(filtered.length / PAGE)); }

  function tableHtml() {
    const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);
    const head = ['№', 'Класс', 'Дата', ...qs.map((q) => q.text)]
      .map((h) => `<th>${esc(h)}</th>`).join('');
    const rows = slice.map((r) => {
      const byQ = {};
      for (const a of r.answers) {
        if (!byQ[a.question_id]) byQ[a.question_id] = [];
        byQ[a.question_id].push(a.option_text || a.text_value);
      }
      const cells = [r.id, r.class || '', fmtDb(r.created_at),
        ...qs.map((q) => esc((byQ[q.id] || []).join('; ')))];
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    }).join('');
    const nav = pages() > 1 ? `
      <div class="pager no-print">
        <button class="btn small ghost" id="indPrev" ${page === 0 ? 'disabled' : ''}>←</button>
        <span class="muted small">Стр. ${page + 1} из ${pages()}</span>
        <button class="btn small ghost" id="indNext" ${page >= pages() - 1 ? 'disabled' : ''}>→</button>
      </div>` : '';
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${nav}`;
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="small muted">Ответы без персональных данных. Найдено: <span id="indCount"></span></p>
    <div class="field no-print" style="max-width:340px"><input id="indSearch" type="text" placeholder="Поиск по классу или тексту ответа"></div>
    <div id="indTable"></div>`;
  const tableBox = wrap.querySelector('#indTable');
  const redraw = () => {
    applyFilter();
    wrap.querySelector('#indCount').textContent = filtered.length;
    tableBox.innerHTML = tableHtml();
    const prev = tableBox.querySelector('#indPrev');
    const next = tableBox.querySelector('#indNext');
    if (prev) prev.addEventListener('click', () => { page -= 1; redraw(); });
    if (next) next.addEventListener('click', () => { page += 1; redraw(); });
  };
  wrap.querySelector('#indSearch').addEventListener('input', (e) => { query = e.target.value; page = 0; redraw(); });
  redraw();
  return wrap;
}

function renderParticipants(d) {
  if (!d.participants.length) return '<div class="empty">Ответов пока нет.</div>';
  const chips = d.by_class.map((c) =>
    `<span class="answer-chip">${esc(c.name)}: <b>${c.count}</b></span>`).join('');
  const rows = d.participants.map((p, i) => `
    <tr><td>${i + 1}</td><td>${esc(p.last_name)} ${esc(p.first_name)}</td><td>${esc(p.class || '')}</td><td>${fmtDb(p.created_at)}</td></tr>`).join('');
  return `
    <p class="small muted">Список прошедших опрос. Раздел доступен только администратору; редактор персональные данные не видит.</p>
    <div style="margin-bottom:12px">${chips}</div>
    <div class="table-wrap"><table><thead><tr><th>№</th><th>Фамилия и имя</th><th>Класс</th><th>Дата</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function viewReport(app, id) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  const data = await api('GET', `/api/admin/surveys/${id}/report`);
  setTitle(`Отчёт: ${data.survey.title}`);
  const classes = data.classes || [];
  const filterOptions = '<option value="">Все классы</option>' +
    classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const sections = data.questions.map(renderQuestionSection).join('');
  const pubMeta = data.survey.published_at ? `<p class="muted small">Опубликован: ${fmtDb(data.survey.published_at)}</p>` : '';

  const tabs = [
    { key: 'summary', label: 'Сводка' },
    { key: 'breakdown', label: 'По классам' }
  ];
  if (currentRole === 'admin') tabs.push({ key: 'participants', label: 'Участники' });
  tabs.push({ key: 'individual', label: 'Индивидуальные' }, { key: 'history', label: 'История' });

  app.innerHTML = adminShell(`Отчёт: ${data.survey.title}`, 'surveys', `
    <div class="card">
      <h2>${esc(data.survey.title)}</h2>
      <p class="muted">Всего ответов: ${data.responses_count}${classes.length ? ` · ${classes.length} ${plural(classes.length, 'класс', 'класса', 'классов')} отвечали` : ''}</p>
      ${pubMeta}
      <div class="report-overview">
        ${data.by_day && data.by_day.length ? `
          <div class="overview-item"><div class="overview-label">Ответы по дням</div>${byDaySvg(data.by_day, 480, 90)}</div>` : ''}
      </div>
      <div class="btn-row no-print">
        <a class="btn" href="/api/admin/surveys/${id}/export.xlsx">${icon('download')} Excel (.xlsx)</a>
        <a class="btn soft" href="/api/admin/surveys/${id}/export.pdf">${icon('download')} PDF</a>
        <button class="btn ghost" id="shareBtn">${icon('qr')} Ссылка и QR</button>
      </div>
      <div class="field no-print" style="max-width:280px;margin-top:12px">
        <label>Класс (фильтр сводки)</label>
        <select id="classFilter">${filterOptions}</select>
      </div>
    </div>
    <div class="tabs no-print" id="reportTabs">
      ${tabs.map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="tabPanel"></div>
    <p class="center small muted no-print"><a href="#/admin/surveys">← К списку опросов</a></p>`);

  const panel = document.getElementById('tabPanel');
  const loaded = {};

  async function loadTab(key) {
    if (loaded[key]) return loaded[key];
    let html;
    if (key === 'summary') {
      html = `<div class="card">${sections}</div>`;
    } else if (key === 'breakdown') {
      html = '<div class="spinner"></div>';
    } else if (key === 'participants') {
      html = '<div class="spinner"></div>';
    } else if (key === 'individual') {
      html = '<div class="spinner"></div>';
    } else {
      html = '<div class="spinner"></div>';
    }
    const el = document.createElement('div');
    el.innerHTML = html;
    loaded[key] = el;
    return el;
  }

  async function activateTab(key) {
    panel.innerHTML = '';
    const el = await loadTab(key);
    panel.appendChild(el);
    if (key === 'breakdown' && !el.dataset.done) {
      el.dataset.done = '1';
      const d = await api('GET', `/api/admin/surveys/${id}/breakdown`);
      el.innerHTML = renderBreakdown(d);
    } else if (key === 'participants' && !el.dataset.done) {
      el.dataset.done = '1';
      const d = await api('GET', `/api/admin/surveys/${id}/participants`);
      el.innerHTML = renderParticipants(d);
    } else if (key === 'individual' && !el.dataset.done) {
      el.dataset.done = '1';
      const d = await api('GET', `/api/admin/surveys/${id}/report/individual`);
      el.innerHTML = '';
      el.appendChild(renderIndividual(d));
    } else if (key === 'history' && !el.dataset.done) {
      el.dataset.done = '1';
      const d = await api('GET', `/api/admin/surveys/${id}/history`);
      el.innerHTML = renderHistory(d.history);
    }
  }

  document.getElementById('reportTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('#reportTabs .tab').forEach((t) => t.classList.toggle('active', t === btn));
    activateTab(btn.dataset.tab);
  });

  document.getElementById('shareBtn').addEventListener('click', () => showShareModal(id, data.survey.title));

  document.getElementById('classFilter').addEventListener('change', async (e) => {
    const cid = e.target.value;
    try {
      const url = cid ? `/api/admin/surveys/${id}/report?class_id=${cid}` : `/api/admin/surveys/${id}/report`;
      const d = await api('GET', url);
      const el = document.createElement('div');
      el.innerHTML = `<div class="card">${d.questions.map(renderQuestionSection).join('')}</div>`;
      loaded.summary = el;
      const active = document.querySelector('#reportTabs .tab.active');
      if (active && active.dataset.tab === 'summary') {
        panel.innerHTML = '';
        panel.appendChild(el);
      }
    } catch (err) { toast(err.message); }
  });

  activateTab('summary');
}

/* ----- настройки ----- */

// Нормализация картинки на клиенте: логотип — квадратный JPEG 512×512,
// фото — JPEG шириной до 1600 px. Возвращает Promise<Blob>.
function normalizeImage(file, mode) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (mode === 'logo') {
        // центр-кроп в квадрат
        const side = Math.min(sw, sh);
        sx = (sw - side) / 2;
        sy = (sh - side) / 2;
        sw = sh = side;
        canvas.width = canvas.height = 512;
      } else {
        const scale = Math.min(1, 1600 / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
      }
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Не удалось обработать изображение'));
      }, 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
    img.src = url;
  });
}

function bindUpload(kind, inputId, previewSel) {
  const input = document.getElementById(inputId);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Выберите файл изображения (JPEG или PNG)'); input.value = ''; return; }
    try {
      const blob = await normalizeImage(file, kind);
      const res = await api('POST', `/api/admin/upload?kind=${kind}`, blob, { type: 'image/jpeg' });
      const img = document.querySelector(previewSel);
      if (img) img.src = res.url;
      toast(kind === 'logo' ? 'Логотип обновлён' : 'Фото обновлено');
      input.value = '';
    } catch (e) { toast(e.message, 6000); input.value = ''; }
  });
}

async function viewSettings(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  if (currentRole !== 'admin') {
    setTitle('Доступ запрещён');
    app.innerHTML = adminShell('Доступ запрещён', 'settings', '<div class="error-banner">У вас нет прав для этого раздела.</div>');
    return;
  }
  setTitle('Настройки');
  const s = await api('GET', '/api/admin/settings');

  app.innerHTML = adminShell('Настройки', 'settings', `
    <div class="card">
      <h2>Портал</h2>
      <div class="field"><label>Название школы</label><input id="schoolName" type="text" value="${esc(s.school_name)}"></div>
      <button class="btn" id="saveSchool">Сохранить название</button>
    </div>
    <div class="card">
      <h2>Брендинг</h2>
      <div class="branding-grid">
        <div class="branding-item">
          <img src="/img/logo.jpg?v=${Date.now()}" class="brand-logo big" id="logoPreview" alt="Логотип">
          <div class="small muted">Логотип (квадрат)</div>
          <label class="btn small soft file-btn">${icon('pencil', 15)} Заменить<input type="file" id="logoFile" accept="image/jpeg,image/png" hidden></label>
        </div>
        <div class="branding-item">
          <img src="/img/photo.jpg?v=${Date.now()}" class="brand-photo-preview" id="photoPreview" alt="Фото школы">
          <div class="small muted">Фото школы на главной</div>
          <label class="btn small soft file-btn">${icon('pencil', 15)} Заменить<input type="file" id="photoFile" accept="image/jpeg,image/png" hidden></label>
        </div>
      </div>
      <p class="small muted" style="margin-top:10px">Файлы обрабатываются в браузере (кадрирование и сжатие в JPEG) и загружаются на сервер без перезапуска.</p>
    </div>
    <div class="card">
      <h2>Смена пароля администратора</h2>
      <div id="pwErr"></div>
      <div class="field"><label>Текущий пароль</label><input id="cur" type="password" autocomplete="current-password"></div>
      <div class="field"><label>Новый пароль (не менее 6 символов)</label><input id="next" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Повторите новый пароль</label><input id="next2" type="password" autocomplete="new-password"></div>
      <button class="btn" id="savePw">Сменить пароль</button>
    </div>
    <div class="card">
      <h2>Редактор портала</h2>
      <p class="small muted">Редактор может создавать и редактировать опросы, управлять классами и смотреть отчёты, но не имеет доступа к настройкам, участникам и не может менять пароли.</p>
      <div id="edErr"></div>
      <div class="field"><label>Пароль редактора</label><input id="edPw" type="password" placeholder="${s.editor_enabled ? 'Введите новый пароль редактора' : 'Введите пароль, чтобы включить вход редактора'}"></div>
      <button class="btn ${s.editor_enabled ? '' : 'soft'}" id="saveEditor">${s.editor_enabled ? 'Изменить пароль редактора' : 'Включить вход редактора'}</button>
      ${s.editor_enabled ? '<button class="btn danger ghost" id="disableEditor" style="margin-left:8px">Отключить вход редактора</button>' : ''}
    </div>
    <p class="small muted">Пароли хранятся в базе данных в виде хэша (scrypt) и не сохраняются в открытом виде.</p>`);

  bindUpload('logo', 'logoFile', '#logoPreview');
  bindUpload('photo', 'photoFile', '#photoPreview');

  document.getElementById('saveSchool').addEventListener('click', async () => {
    const v = document.getElementById('schoolName').value.trim();
    if (!v) { toast('Введите название школы'); return; }
    try {
      await api('POST', '/api/admin/settings', { school_name: v });
      schoolName = v;
      toast('Название сохранено');
    } catch (e) { toast(e.message); }
  });

  document.getElementById('savePw').addEventListener('click', async () => {
    const err = document.getElementById('pwErr');
    const cur = document.getElementById('cur').value;
    const next = document.getElementById('next').value;
    const next2 = document.getElementById('next2').value;
    if (!cur) { err.innerHTML = '<div class="error-banner">Введите текущий пароль</div>'; return; }
    if (next.length < 6) { err.innerHTML = '<div class="error-banner">Новый пароль должен содержать не менее 6 символов</div>'; return; }
    if (next !== next2) { err.innerHTML = '<div class="error-banner">Пароли не совпадают</div>'; return; }
    try {
      await api('POST', '/api/admin/change-password', { current: cur, next });
      err.innerHTML = '<div class="success-banner">Пароль изменён</div>';
      document.getElementById('cur').value = '';
      document.getElementById('next').value = '';
      document.getElementById('next2').value = '';
    } catch (e) {
      err.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
    }
  });

  const edErr = document.getElementById('edErr');
  document.getElementById('saveEditor').addEventListener('click', async () => {
    const v = document.getElementById('edPw').value;
    if (v && v.length < 6) { edErr.innerHTML = '<div class="error-banner">Пароль должен содержать не менее 6 символов</div>'; return; }
    try {
      await api('POST', '/api/admin/editor-password', { next: v });
      edErr.innerHTML = '<div class="success-banner">Сохранено</div>';
      viewSettings(app);
    } catch (e) { edErr.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`; }
  });
  const disableBtn = document.getElementById('disableEditor');
  if (disableBtn) disableBtn.addEventListener('click', async () => {
    try {
      await api('POST', '/api/admin/editor-password', { next: '' });
      viewSettings(app);
    } catch (e) { toast(e.message); }
  });
}

/* ================= роутер ================= */

const routes = [
  [/^#\/$/, (m, app) => viewHome(app)],
  [/^#\/login\/(\d+)$/, (m, app) => viewLogin(app, m[1])],
  [/^#\/survey\/(\d+)$/, (m, app) => viewSurvey(app, m[1])],
  [/^#\/done$/, (m, app) => viewDone(app)],
  [/^#\/admin$/, async (m, app) => { if (await ensureStaff()) viewDashboard(app); else renderAdminLogin(app); }],
  [/^#\/admin\/surveys$/, (m, app) => viewAdminSurveys(app)],
  [/^#\/admin\/survey\/new$/, (m, app) => viewEditor(app, null)],
  [/^#\/admin\/survey\/(\d+)$/, (m, app) => viewEditor(app, m[1])],
  [/^#\/admin\/classes$/, (m, app) => viewClasses(app)],
  [/^#\/admin\/report\/(\d+)$/, (m, app) => viewReport(app, m[1])],
  [/^#\/admin\/settings$/, (m, app) => viewSettings(app)]
];

async function route() {
  const app = document.getElementById('app');
  const hash = location.hash || '#/';
  try {
    for (const [re, handler] of routes) {
      const m = re.exec(hash);
      if (m) { await handler(m, app); return; }
    }
    setTitle('Страница не найдена');
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Страница не найдена.</div><a class="btn" href="#/">На главную</a></div></div>`;
  } catch (e) {
    console.error(e);
    setTitle('Ошибка');
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">${esc(e.message)}</div><a class="btn" href="#/">На главную</a></div></div>`;
  }
}

document.addEventListener('click', (e) => {
  const menu = e.target.closest('#menuBtn');
  if (menu) {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('open');
    return;
  }
  const el = e.target.closest('[data-action="logout"]');
  if (el) {
    e.preventDefault();
    api('POST', '/api/admin/logout').catch(() => {});
    location.hash = '#/';
  }
});

window.addEventListener('hashchange', route);
route();
