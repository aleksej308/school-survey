'use strict';
// Регрессионный тест фронтенда: каждый маршрут SPA должен рендерить непустой HTML.
// Запуск: node scripts/test-frontend.js
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

function jsonRes(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => obj,
    text: async () => ''
  };
}

function el() {
  return {
    innerHTML: '', value: '', textContent: '', className: '', style: {},
    addEventListener() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => el(),
    classList: { add() {}, remove() {}, toggle() {} },
    closest: () => null
  };
}

async function render(hash, authed) {
  const app = el();
  const sandbox = {
    document: {
      getElementById: (id) => (id === 'app' ? app : el()),
      addEventListener: () => {},
      createElement: () => el(),
      body: { appendChild: () => {} },
      querySelectorAll: () => []
    },
    window: { addEventListener: () => {} },
    location: { hash },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/api/bootstrap')) return jsonRes({ surveys: [], classes: [{ id: 1, name: '9А' }] });
      if (u.includes('/api/admin/me')) return jsonRes({ authed });
      if (u.includes('/api/admin/surveys')) return jsonRes({ surveys: [] });
      if (u.includes('/api/admin/classes')) return jsonRes({ classes: [] });
      return jsonRes({});
    },
    confirm: () => false,
    prompt: () => null,
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 50));
  return app.innerHTML;
}

(async () => {
  const cases = [
    ['', false, 'главная'],
    ['#/done', false, 'страница «спасибо»'],
    ['#/admin', false, 'вход администратора'],
    ['#/admin/surveys', false, 'опросы (без входа)'],
    ['#/admin/surveys', true, 'опросы (авторизован)'],
    ['#/admin/classes', true, 'классы (авторизован)'],
    ['#/admin/settings', true, 'настройки (авторизован)']
  ];
  let fail = 0;
  for (const [hash, authed, name] of cases) {
    const html = await render(hash, authed);
    const ok = html.length > 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${html.length} симв.)`);
  }
  console.log(fail === 0 ? '\nФронтенд-тест: OK' : '\nФронтенд-тест: ОШИБКИ');
  process.exit(fail ? 1 : 0);
})();
