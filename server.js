'use strict';

/**
 * Сервер приложения «Школьные опросы».
 * Встроенный http + node:sqlite, без внешних зависимостей.
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const db = require('./lib/db');
const auth = require('./lib/auth');
const { buildXlsx } = require('./lib/xlsx');
const { buildPdf } = require('./lib/pdf');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const FONT_PATH = process.env.FONT_PATH || path.join(ROOT, 'fonts', 'DejaVuSans.ttf');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// На общей школьной сети (один внешний IP на всех) держите ENFORCE_IP=0.
const ENFORCE_IP = process.env.ENFORCE_IP === '1';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Ограничение попыток входа администратора (защита от перебора пароля).
const LOGIN_MAX_ATTEMPTS = 5;             // попыток
const LOGIN_WINDOW_MS = 15 * 60 * 1000;   // за 15 минут
const loginAttempts = new Map();          // ip -> { count, resetAt }

// Признак защищённого (HTTPS) соединения — нужен, чтобы ставить флаг Secure у cookie.
function isSecureReq(req) {
  if (req.socket && req.socket.encrypted) return true;
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
  return false;
}

/* ---------- инициализация настроек ---------- */

function initSettings() {
  let secret = db.getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    db.setSetting('session_secret', secret);
  }
  let firstRun = false;
  if (!db.getSetting('admin_password_hash')) {
    db.setSetting('admin_password_hash', auth.hashPassword(DEFAULT_ADMIN_PASSWORD));
    firstRun = true;
  }
  return { secret, firstRun };
}

const { secret: SESSION_SECRET, firstRun } = initSettings();

/* ---------- вспомогательные ---------- */

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendBuffer(res, status, contentType, buffer, filename) {
  const headers = {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store'
  };
  if (filename) {
    const ext = path.extname(filename);
    const fallback = 'report' + (ext || '');
    headers['Content-Disposition'] =
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  res.writeHead(status, headers);
  res.end(buffer);
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function getAdminToken(req) {
  return auth.parseCookies(req)['admin_token'] || null;
}

function isAdmin(req) {
  return auth.verifyAdminToken(getAdminToken(req), SESSION_SECRET);
}

function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'Требуется вход администратора' });
    return false;
  }
  return true;
}

// Простая защита от CSRF: отклоняем запросы, меняющие состояние, с чужого сайта.
function isCrossSite(req) {
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return true;
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    sendJson(res, 403, { error: 'Доступ запрещён' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-fallback: отдаём index.html для путей без расширения
      if (err.code === 'ENOENT' && !path.extname(rel)) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) { sendJson(res, 404, { error: 'Не найдено' }); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': html.length });
          res.end(html);
        });
        return;
      }
      sendJson(res, 404, { error: 'Не найдено' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  });
}

/* ---------- маршрутизация ---------- */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method, regex, keys, handler });
}

/* ===== Публичные ===== */

route('GET', '/api/bootstrap', (req, res) => {
  const surveys = db.listSurveys(false).filter((s) => s.published).map((s) => ({
    id: s.id, title: s.title, description: s.description
  }));
  const classes = db.listClasses();
  sendJson(res, 200, { surveys, classes });
});

route('GET', '/api/classes', (req, res) => {
  sendJson(res, 200, { classes: db.listClasses() });
});

route('GET', '/api/survey/:id', (req, res, params) => {
  const s = db.getSurvey(Number(params.id));
  if (!s || !s.published) {
    sendJson(res, 404, { error: 'Опрос не найден или не опубликован' });
    return;
  }
  sendJson(res, 200, {
    id: s.id,
    title: s.title,
    description: s.description,
    questions: s.questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      required: !!q.required,
      options: q.options.map((o) => ({ id: o.id, text: o.text }))
    }))
  });
});

route('POST', '/api/survey/:id/submit', async (req, res, params) => {
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const surveyId = Number(params.id);
  const survey = db.getSurvey(surveyId);
  if (!survey || !survey.published) {
    sendJson(res, 404, { error: 'Опрос не найден или не опубликован' });
    return;
  }

  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const classId = body.class_id ? Number(body.class_id) : null;

  const missing = [];
  if (!firstName) missing.push('имя');
  if (!lastName) missing.push('фамилию');
  if (!classId) missing.push('класс');
  if (missing.length) {
    sendJson(res, 400, { error: `Необходимо указать: ${missing.join(', ')}` });
    return;
  }
  const cls = db.getClass(classId);
  if (!cls) { sendJson(res, 400, { error: 'Указан неверный класс' }); return; }

  // Проверка «один раз»
  // 1) cookie: с этого устройства уже отправляли этот опрос
  if (auth.parseCookies(req)[`taken_${surveyId}`]) {
    sendJson(res, 409, { error: 'Вы уже проходили этот опрос с этого устройства.' });
    return;
  }
  // 2) уникальность ФИО + класс
  const existing = db.findExistingResponse(surveyId, firstName, lastName, classId);
  if (existing) {
    sendJson(res, 409, { error: 'Вы уже проходили этот опрос. Повторное прохождение невозможно.' });
    return;
  }
  const ip = auth.getClientIp(req, TRUST_PROXY);
  if (ENFORCE_IP && db.countResponsesByIp(surveyId, ip) > 0) {
    sendJson(res, 409, { error: 'С этого IP-адреса уже отправлен ответ на этот опрос.' });
    return;
  }

  // Валидация ответов
  try {
    validateAnswers(survey, body.answers);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
    return;
  }

  const responseId = db.saveResponse(
    surveyId, firstName, lastName, classId, ip, body.answers
  );

  setCookie(res, `taken_${surveyId}`, '1', { maxAge: 365 * 24 * 60 * 60, httpOnly: true, secure: isSecureReq(req) });
  sendJson(res, 200, { ok: true, response_id: responseId });
});

function validateAnswers(survey, answers) {
  const list = Array.isArray(answers) ? answers : [];
  for (const q of survey.questions) {
    if (q.type === 'text') {
      const a = list.find((x) => Number(x.question_id) === q.id);
      const tv = (a && a.text ? String(a.text).trim() : '');
      if (q.required && !tv) throw new Error(`Ответьте на вопрос: ${q.text}`);
    } else {
      const a = list.find((x) => Number(x.question_id) === q.id);
      let ids = a && Array.isArray(a.option_ids) ? a.option_ids : (a && a.option_ids ? [a.option_ids] : []);
      ids = ids.map(Number).filter((n) => n);
      if (q.type === 'single' && q.required && ids.length !== 1) {
        throw new Error(`Выберите один вариант в вопросе: ${q.text}`);
      }
      if (q.type === 'multiple' && q.required && ids.length === 0) {
        throw new Error(`Выберите хотя бы один вариант в вопросе: ${q.text}`);
      }
      const validIds = new Set(q.options.map((o) => o.id));
      for (const id of ids) if (!validIds.has(id)) throw new Error('Некорректный вариант ответа');
    }
  }
}

/* ===== Админ: авторизация ===== */

route('POST', '/api/admin/login', async (req, res) => {
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  const ip = auth.getClientIp(req, TRUST_PROXY);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((entry.resetAt - now) / 60000);
    sendJson(res, 429, { error: `Слишком много попыток входа. Попробуйте через ${waitMin} мин.` });
    return;
  }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  const password = String(body.password || '');
  const hash = db.getSetting('admin_password_hash');
  if (!password || !auth.verifyPassword(password, hash)) {
    if (!entry || entry.resetAt <= now) {
      loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      entry.count += 1;
    }
    await new Promise((r) => setTimeout(r, 500)); // замедляем перебор
    sendJson(res, 401, { error: 'Неверный пароль' });
    return;
  }
  loginAttempts.delete(ip);
  const token = auth.createAdminToken(SESSION_SECRET, ADMIN_TTL_MS);
  setCookie(res, 'admin_token', token, { maxAge: Math.floor(ADMIN_TTL_MS / 1000), httpOnly: true, secure: isSecureReq(req) });
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/logout', (req, res) => {
  clearCookie(res, 'admin_token');
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/admin/me', (req, res) => {
  sendJson(res, 200, { authed: isAdmin(req) });
});

route('POST', '/api/admin/change-password', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (next.length < 6) { sendJson(res, 400, { error: 'Новый пароль должен содержать не менее 6 символов' }); return; }
  if (!auth.verifyPassword(current, db.getSetting('admin_password_hash'))) {
    sendJson(res, 401, { error: 'Текущий пароль неверен' });
    return;
  }
  db.setSetting('admin_password_hash', auth.hashPassword(next));
  sendJson(res, 200, { ok: true });
});

/* ===== Админ: классы ===== */

route('GET', '/api/admin/classes', (req, res) => {
  if (!requireAdmin(req, res)) return;
  sendJson(res, 200, { classes: db.listClasses() });
});

route('POST', '/api/admin/classes', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  try {
    sendJson(res, 200, { class: db.createClass(body.name) });
  } catch (e) {
    sendJson(res, 400, { error: e.message.includes('UNIQUE') ? 'Такой класс уже существует' : e.message });
  }
});

route('PUT', '/api/admin/classes/:id', async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  try {
    sendJson(res, 200, { class: db.renameClass(Number(params.id), body.name) });
  } catch (e) {
    sendJson(res, 400, { error: e.message.includes('UNIQUE') ? 'Такой класс уже существует' : e.message });
  }
});

route('DELETE', '/api/admin/classes/:id', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  db.deleteClass(Number(params.id));
  sendJson(res, 200, { ok: true });
});

/* ===== Админ: опросы ===== */

route('GET', '/api/admin/surveys', (req, res) => {
  if (!requireAdmin(req, res)) return;
  sendJson(res, 200, { surveys: db.listSurveys(true) });
});

route('POST', '/api/admin/surveys', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  try {
    validateSurveyInput(body);
    sendJson(res, 200, { survey: db.createSurvey(body) });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

route('GET', '/api/admin/surveys/:id', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const s = db.getSurvey(Number(params.id));
  if (!s) { sendJson(res, 404, { error: 'Опрос не найден' }); return; }
  sendJson(res, 200, { survey: s });
});

route('PUT', '/api/admin/surveys/:id', async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  try {
    validateSurveyInput(body);
    sendJson(res, 200, { survey: db.updateSurvey(Number(params.id), body) });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

route('DELETE', '/api/admin/surveys/:id', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  db.deleteSurvey(Number(params.id));
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/surveys/:id/publish', async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  if (isCrossSite(req)) { sendJson(res, 403, { error: 'Запрос отклонён' }); return; }
  let body;
  try { body = await readJson(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  try {
    sendJson(res, 200, { survey: db.setPublished(Number(params.id), !!body.published) });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

function validateSurveyInput(body) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Укажите название опроса');
  const questions = Array.isArray(body.questions) ? body.questions : [];
  if (questions.length === 0) throw new Error('Добавьте хотя бы один вопрос');
  for (const q of questions) {
    const text = String(q.text || '').trim();
    if (!text) throw new Error('Текст вопроса не может быть пустым');
    if (!['single', 'multiple', 'text'].includes(q.type)) throw new Error('Неверный тип вопроса');
    if (q.type !== 'text') {
      const opts = Array.isArray(q.options) ? q.options.filter((o) => String(o.text || '').trim()) : [];
      if (opts.length < 2) throw new Error(`Добавьте минимум два варианта ответа в вопросе: ${text}`);
    }
  }
}

/* ===== Админ: отчёты ===== */

route('GET', '/api/admin/surveys/:id/report', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const summary = db.getSummary(Number(params.id));
  if (!summary) { sendJson(res, 404, { error: 'Опрос не найден' }); return; }
  sendJson(res, 200, summary);
});

route('GET', '/api/admin/surveys/:id/report/individual', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const s = db.getSurvey(Number(params.id));
  if (!s) { sendJson(res, 404, { error: 'Опрос не найден' }); return; }
  sendJson(res, 200, { survey: s, responses: db.getIndividualAnswers(Number(params.id)) });
});

function formatDate(sqliteDate) {
  if (!sqliteDate) return '';
  // sqlite datetime('now') => "YYYY-MM-DD HH:MM:SS" (UTC)
  const d = new Date(sqliteDate.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(sqliteDate);
  return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}

function buildReportXlsx(surveyId) {
  const summary = db.getSummary(surveyId);
  const survey = summary.survey;
  const typeLabel = { single: 'Один вариант', multiple: 'Несколько вариантов', text: 'Свободный ответ' };

  const summaryRows = [
    [{ v: 'Вопрос', bold: true }, { v: 'Вариант / ответ', bold: true }, { v: 'Кол-во', bold: true }, { v: 'Доля (%)', bold: true }]
  ];
  for (const q of summary.questions) {
    summaryRows.push([{ v: q.text, bold: true }, { v: typeLabel[q.type], bold: false }, '', '']);
    if (q.type === 'text') {
      summaryRows.push(['', { v: `Всего ответов: ${q.total}` }, '', '']);
      for (const a of q.answers) {
        summaryRows.push(['', a.text, a.class ? `${a.first_name} ${a.last_name} (${a.class})` : `${a.first_name} ${a.last_name}`, '']);
      }
    } else {
      for (const o of q.options) {
        summaryRows.push(['', o.text, o.count, o.percent]);
      }
    }
    summaryRows.push([]);
  }

  const questionTexts = summary.questions.map((q) => q.text);
  const answerRows = [
    [{ v: '№', bold: true }, { v: 'Имя', bold: true }, { v: 'Фамилия', bold: true }, { v: 'Класс', bold: true }, { v: 'Дата', bold: true },
      ...questionTexts.map((t) => ({ v: t, bold: true }))]
  ];
  const responses = db.getIndividualAnswers(surveyId);
  responses.forEach((r) => {
    const byQuestion = {};
    for (const a of r.answers) {
      if (!byQuestion[a.question_id]) byQuestion[a.question_id] = [];
      byQuestion[a.question_id].push(a.option_text || a.text_value);
    }
    const row = [r.id, r.first_name, r.last_name, r.class || '', formatDate(r.created_at)];
    for (const q of summary.questions) {
      row.push((byQuestion[q.id] || []).join('; '));
    }
    answerRows.push(row);
  });

  return buildXlsx([
    { name: 'Сводка', rows: summaryRows },
    { name: 'Ответы', rows: answerRows }
  ]);
}

function buildReportPdf(surveyId) {
  const summary = db.getSummary(surveyId);
  const survey = summary.survey;
  const typeLabel = { single: '(один вариант)', multiple: '(несколько вариантов)', text: '(свободный ответ)' };

  const sections = [];
  let idx = 0;
  for (const q of summary.questions) {
    idx += 1;
    const lines = [];
    if (q.type === 'text') {
      lines.push(`Всего ответов: ${q.total}`);
      if (q.answers.length === 0) lines.push('— ответов нет —');
      for (const a of q.answers) {
        lines.push(`• ${a.text} (${a.first_name} ${a.last_name}${a.class ? ', ' + a.class : ''})`);
      }
    } else {
      if (q.total === 0) lines.push('— ответов нет —');
      for (const o of q.options) {
        lines.push(`• ${o.text} — ${o.count} (${o.percent}%)`);
      }
    }
    sections.push({ heading: `${idx}. ${q.text} ${typeLabel[q.type]}`, lines });
  }

  return buildPdf({
    title: `Отчёт по опросу: ${survey.title}`,
    subtitle: [
      survey.description ? `Описание: ${survey.description}` : '',
      `Всего ответов: ${summary.responses_count}`,
      `Сформирован: ${formatDate(new Date().toISOString().slice(0, 19).replace('T', ' '))}`
    ].filter(Boolean),
    sections
  }, FONT_PATH);
}

route('GET', '/api/admin/surveys/:id/export.xlsx', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const survey = db.getSurvey(Number(params.id));
  if (!survey) { sendJson(res, 404, { error: 'Опрос не найден' }); return; }
  const buf = buildReportXlsx(Number(params.id));
  const safeName = survey.title.replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim() || 'survey';
  sendBuffer(res, 200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf, `Отчёт_${safeName}.xlsx`);
});

route('GET', '/api/admin/surveys/:id/export.pdf', (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const survey = db.getSurvey(Number(params.id));
  if (!survey) { sendJson(res, 404, { error: 'Опрос не найден' }); return; }
  try {
    const buf = buildReportPdf(Number(params.id));
    const safeName = survey.title.replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim() || 'survey';
    sendBuffer(res, 200, 'application/pdf', buf, `Отчёт_${safeName}.pdf`);
  } catch (e) {
    sendJson(res, 500, { error: 'Не удалось сформировать PDF: ' + e.message });
  }
});

/* ===== запуск сервера ===== */

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { url = new URL('/', 'http://localhost'); }
    const pathname = url.pathname;
    // HEAD обрабатываем как GET (тело ответа Node отбросит автоматически).
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    // Статический маршрут /s/:id — отдаём index.html
    if (method === 'GET' && /^\/s\/\d+/.test(pathname)) {
      serveStatic(req, res, '/index.html');
      return;
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        await r.handler(req, res, params, url);
        return;
      }
    }

    if (method === 'GET') {
      serveStatic(req, res, pathname);
    } else {
      sendJson(res, 404, { error: 'Не найдено' });
    }
  } catch (e) {
    try {
      if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      else res.end();
    } catch (_) { /* ignore */ }
    console.error(e);
  }
});

server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  Школьные опросы — сервер запущен');
  console.log(`  Адрес: http://localhost:${PORT}`);
  if (firstRun) {
    console.log(`  Пароль администратора (по умолчанию): ${DEFAULT_ADMIN_PASSWORD}`);
    console.log('  Смените его после первого входа в разделе «Настройки».');
  }
  if (ENFORCE_IP) console.log('  ВНИМАНИЕ: включена блокировка по IP (ENFORCE_IP=1).');
  console.log('==============================================');
});
