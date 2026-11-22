'use strict';
// Тест режима «без классов» (CLASSES_ENABLED=0). Запускать при сервере,
// запущенном с этим флагом: node scripts/e2e-classes-off.js
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3212';

let jar = {};
function applyCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const eq = sc.indexOf('=');
    if (eq > 0) jar[sc.slice(0, eq).trim()] = sc.slice(eq + 1, sc.indexOf(';') === -1 ? undefined : sc.indexOf(';')).trim();
  }
}
function cookieHeader() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }

async function req(method, path, body) {
  const opts = { method, headers: {} };
  const c = cookieHeader();
  if (c) opts.headers.Cookie = c;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(BASE + path, opts);
  applyCookies(res);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) { try { data = await res.json(); } catch { data = null; } }
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/bootstrap'); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('Сервер не отвечает на ' + BASE);
}

(async () => {
  await waitServer();

  let r = await req('GET', '/api/bootstrap');
  check('bootstrap: classes_enabled=false', r.data.classes_enabled === false);
  check('bootstrap: classes пуст', Array.isArray(r.data.classes) && r.data.classes.length === 0);

  r = await req('POST', '/api/admin/login', { password: 'admin123' });
  check('вход админа -> 200', r.status === 200);
  r = await req('GET', '/api/admin/me');
  check('admin/me: classes_enabled=false', r.data.classes_enabled === false);

  // опрос со шкалой без вариантов
  r = await req('POST', '/api/admin/surveys', {
    title: 'Опрос без классов',
    questions: [{ text: 'Оцени проект', type: 'scale', required: true, scale_max: 5, options: [] }]
  });
  const sid = r.data.survey.id;
  r = await req('POST', `/api/admin/surveys/${sid}/publish`, { published: true });
  check('публикация -> 200', r.status === 200);

  // отправка без class_id (куку админа сохраняем — она понадобится для отчётов)
  const adminJar = { ...jar };
  const qs = (await req('GET', `/api/survey/${sid}`)).data.questions;
  r = await req('POST', `/api/survey/${sid}/submit`, {
    first_name: 'Вика', last_name: 'Викова',
    answers: [{ question_id: qs[0].id, scale: 5 }]
  });
  check('ответ без класса -> 200', r.status === 200, r.data);

  // дедупликация при NULL-классе: тот же участник -> 409
  jar = {};
  r = await req('POST', `/api/survey/${sid}/submit`, {
    first_name: 'Вика', last_name: 'Викова',
    answers: [{ question_id: qs[0].id, scale: 4 }]
  });
  check('повтор без класса -> 409 (дедуп работает)', r.status === 409, r.data);

  // другой участник проходит
  r = await req('POST', `/api/survey/${sid}/submit`, {
    first_name: 'Оля', last_name: 'Опросова',
    answers: [{ question_id: qs[0].id, scale: 4 }]
  });
  check('второй участник -> 200', r.status === 200);
  jar = adminJar;

  // участники: класс пустой
  r = await req('GET', `/api/admin/surveys/${sid}/participants`);
  check('участники: 2, класс null', r.status === 200 && r.data.participants.length === 2 && r.data.by_class.length === 0);

  // разбивка: без классов
  r = await req('GET', `/api/admin/surveys/${sid}/breakdown`);
  check('разбивка: classes пуст', r.status === 200 && r.data.classes.length === 0);

  // отчёт по шкале работает
  r = await req('GET', `/api/admin/surveys/${sid}/report`);
  check('отчёт: средняя 4.5', r.status === 200 && r.data.questions[0].average === 4.5);

  console.log(`\nИТОГО: ${pass} прошло, ${fail} упало`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
