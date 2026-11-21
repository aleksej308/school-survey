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

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString('ru-RU', { hour12: false });
}

async function api(method, url, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
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

async function ensureAdmin() {
  try {
    const d = await api('GET', '/api/admin/me');
    return !!d.authed;
  } catch {
    return false;
  }
}

/* ================= admin layout ================= */

function adminShell(title, active, contentHtml) {
  const link = (href, label, key) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `
    <header class="app-header">
      <div class="inner">
        <div class="brand"><a href="#/admin/surveys">🏫 Школьные опросы</a></div>
        <nav>
          ${link('#/admin/surveys', 'Опросы', 'surveys')}
          ${link('#/admin/classes', 'Классы', 'classes')}
          ${link('#/admin/settings', 'Настройки', 'settings')}
          <a href="#" data-action="logout">Выйти</a>
        </nav>
      </div>
    </header>
    <div class="container wide">
      <h1>${esc(title)}</h1>
      ${contentHtml}
    </div>`;
}

function renderAdminLogin(app) {
  app.innerHTML = `
    <div class="container">
      <div class="card" style="max-width:400px;margin:36px auto">
        <h1>Вход администратора</h1>
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
      await api('POST', '/api/admin/login', { password: document.getElementById('pw').value });
      location.hash = '#/admin/surveys';
    } catch (e) {
      err.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

/* ================= respondent views ================= */

async function viewHome(app) {
  const data = await api('GET', '/api/bootstrap');
  const surveys = data.surveys;
  let listHtml;
  if (surveys.length === 0) {
    listHtml = `<div class="empty"><div class="big">📋</div>Сейчас нет активных опросов.<br>Загляните позже.</div>`;
  } else {
    listHtml = surveys.map((s) => `
      <a class="list-item" href="#/login/${s.id}">
        <div class="grow">
          <div class="title">${esc(s.title)}</div>
          ${s.description ? `<div class="sub">${esc(s.description)}</div>` : ''}
        </div>
        <span style="font-size:22px;color:var(--muted)">→</span>
      </a>`).join('');
  }
  app.innerHTML = `
    <div class="container">
      <div class="hero">
        <div class="logo">🏫</div>
        <h1>Школьные опросы</h1>
        <p>Выберите опрос, укажите имя, фамилию и класс — и ответьте на вопросы.</p>
      </div>
      <div class="card">${listHtml}</div>
      <p class="center small muted"><a href="#/admin">Вход для администратора</a></p>
    </div>`;
}

async function viewLogin(app, id) {
  const data = await api('GET', '/api/bootstrap');
  const survey = data.surveys.find((s) => s.id === Number(id));
  if (!survey) {
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Опрос не найден или не опубликован.</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }
  if (data.classes.length === 0) {
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Список классов ещё не настроен. Обратитесь к администратору.</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }
  const options = data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  app.innerHTML = `
    <div class="container">
      <div class="card">
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

async function viewSurvey(app, id) {
  const resp = JSON.parse(sessionStorage.getItem(`resp_${id}`) || 'null');
  if (!resp) { location.hash = `#/login/${id}`; return; }
  let survey;
  try {
    survey = await api('GET', `/api/survey/${id}`);
  } catch (e) {
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">${esc(e.message)}</div><a class="btn" href="#/">На главную</a></div></div>`;
    return;
  }

  const qHtml = survey.questions.map((q, i) => {
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let body;
    if (q.type === 'text') {
      body = `<textarea data-q="${q.id}" placeholder="Ваш ответ"></textarea>`;
    } else {
      body = q.options.map((o) => `
        <label class="option">
          <input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="q${q.id}" value="${o.id}">
          <span class="opt-text">${esc(o.text)}</span>
        </label>`).join('');
    }
    const hint = q.type === 'single' ? 'Выберите один вариант' : q.type === 'multiple' ? 'Можно выбрать несколько вариантов' : '';
    return `<div class="question-card">
      <div class="q-text">${i + 1}. ${esc(q.text)}${req}</div>
      ${hint ? `<div class="q-hint">${hint}</div>` : ''}
      ${body}
    </div>`;
  }).join('');

  app.innerHTML = `
    <div class="container">
      <div class="card">
        <h1>${esc(survey.title)}</h1>
        <p class="muted small">Участник: ${esc(resp.first_name)} ${esc(resp.last_name)}</p>
        <div id="surveyErr"></div>
      </div>
      ${qHtml}
      <button class="btn block" id="submitBtn">Отправить ответы</button>
      <p class="center small muted" style="margin-top:10px"><a href="#/">Отмена</a></p>
    </div>`;

  app.querySelectorAll('.option input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const opt = inp.closest('.option');
      if (inp.type === 'radio') {
        opt.parentElement.querySelectorAll('.option').forEach((o) => o.classList.remove('selected'));
      }
      opt.classList.toggle('selected', inp.checked);
    });
  });

  const showErr = (msg) => {
    document.getElementById('surveyErr').innerHTML = `<div class="error-banner">${esc(msg)}</div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  document.getElementById('submitBtn').addEventListener('click', async () => {
    const answers = [];
    for (const q of survey.questions) {
      if (q.type === 'text') {
        const ta = app.querySelector(`[data-q="${q.id}"]`);
        answers.push({ question_id: q.id, text: ta ? ta.value : '' });
      } else {
        const checked = [...app.querySelectorAll(`input[name="q${q.id}"]:checked`)].map((i) => Number(i.value));
        answers.push({ question_id: q.id, option_ids: checked });
      }
    }
    // клиентская валидация обязательных вопросов
    for (const q of survey.questions) {
      const a = answers.find((x) => x.question_id === q.id);
      if (!q.required) continue;
      if (q.type === 'text' && !(a.text || '').trim()) { showErr(`Ответьте на вопрос: «${q.text}»`); return; }
      if (q.type === 'single' && a.option_ids.length !== 1) { showErr(`Выберите один вариант в вопросе: «${q.text}»`); return; }
      if (q.type === 'multiple' && a.option_ids.length === 0) { showErr(`Выберите хотя бы один вариант в вопросе: «${q.text}»`); return; }
    }
    const btn = document.getElementById('submitBtn');
    try {
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      await api('POST', `/api/survey/${id}/submit`, {
        first_name: resp.first_name,
        last_name: resp.last_name,
        class_id: resp.class_id,
        answers
      });
      sessionStorage.setItem(`done_${id}`, '1');
      sessionStorage.removeItem(`resp_${id}`);
      location.hash = '#/done';
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Отправить ответы';
      showErr(e.message);
      if (/уже проходили|уже отправлен/.test(e.message)) {
        sessionStorage.setItem(`done_${id}`, '1');
        setTimeout(() => { location.hash = '#/done'; }, 1600);
      }
    }
  });
}

function viewDone(app) {
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

/* ================= admin views ================= */

async function viewAdminSurveys(app) {
  if (!await ensureAdmin()) { renderAdminLogin(app); return; }
  const data = await api('GET', '/api/admin/surveys');
  const surveys = data.surveys;
  const list = surveys.length ? surveys.map((s) => `
    <div class="list-item">
      <div class="grow">
        <div class="title">${esc(s.title)}</div>
        <div class="sub">Вопросов: ${s.questions_count} · Ответов: ${s.responses_count} · <span class="badge ${s.published ? 'published' : 'draft'}">${s.published ? 'Опубликован' : 'Черновик'}</span></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="btn small soft" href="#/admin/report/${s.id}">Отчёт</a>
        <a class="btn small ghost" href="#/admin/survey/${s.id}">Изменить</a>
        <button class="btn small ${s.published ? 'ghost' : 'soft'}" data-toggle="${s.id}" data-pub="${s.published ? 0 : 1}">${s.published ? 'Снять' : 'Опубликовать'}</button>
      </div>
    </div>`).join('') : `<div class="empty"><div class="big">📝</div>Пока нет опросов. Нажмите «Новый опрос», чтобы создать.</div>`;

  app.innerHTML = adminShell('Опросы', 'surveys', `
    <div class="btn-row" style="margin-bottom:14px"><a class="btn" href="#/admin/survey/new">＋ Новый опрос</a></div>
    <div class="card">${list}</div>`);

  app.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api('POST', `/api/admin/surveys/${b.dataset.toggle}/publish`, { published: b.dataset.pub === '1' });
        viewAdminSurveys(app);
      } catch (e) { toast(e.message); }
    });
  });
}

/* ----- редактор опроса ----- */

let ES = null;

function newQuestion(type) {
  return { text: '', type: type || 'single', required: true, options: type === 'text' ? [] : ['', ''] };
}

function questionHtml(q, i) {
  const optArea = q.type === 'text' ? '' : `
    <div data-optarea="${i}" style="margin-bottom:10px">
      ${q.options.map((o, oi) => `
        <div class="option-edit-row">
          <input type="text" value="${esc(o)}" data-q="${i}" data-opt="${oi}" placeholder="Вариант ${oi + 1}">
          <button type="button" class="icon-btn danger" data-delopt="${i}" data-oi="${oi}" title="Удалить вариант">✕</button>
        </div>`).join('')}
      <button type="button" class="btn small ghost" data-addopt="${i}">＋ Вариант</button>
    </div>`;
  return `
    <div class="editor-question">
      <div class="q-head">
        <div class="num">${i + 1}.</div>
        <div class="q-body">
          <div class="field"><input type="text" value="${esc(q.text)}" data-qtext="${i}" placeholder="Текст вопроса"></div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
            <select data-qtype="${i}" style="flex:1;min-width:180px">
              <option value="single" ${q.type === 'single' ? 'selected' : ''}>Один вариант</option>
              <option value="multiple" ${q.type === 'multiple' ? 'selected' : ''}>Несколько вариантов</option>
              <option value="text" ${q.type === 'text' ? 'selected' : ''}>Свободный ответ</option>
            </select>
            <label class="check"><input type="checkbox" data-qreq="${i}" ${q.required ? 'checked' : ''}> Обязательный</label>
          </div>
          ${optArea}
          <button type="button" class="btn small danger ghost" data-delq="${i}">Удалить вопрос</button>
        </div>
      </div>
    </div>`;
}

async function viewEditor(app, id) {
  if (!await ensureAdmin()) { renderAdminLogin(app); return; }
  let existing = null;
  if (id) {
    existing = (await api('GET', `/api/admin/surveys/${id}`)).survey;
  }
  ES = {
    id: id || null,
    title: existing ? existing.title : '',
    description: existing ? existing.description : '',
    questions: existing
      ? existing.questions.map((q) => ({ text: q.text, type: q.type, required: !!q.required, options: q.options.map((o) => o.text) }))
      : [newQuestion()]
  };

  app.innerHTML = adminShell(id ? 'Редактирование опроса' : 'Новый опрос', 'surveys', `
    <div id="editorErr"></div>
    <div class="card">
      <div class="field"><label>Название опроса</label><input id="svTitle" type="text" value="${esc(ES.title)}" placeholder="Например: Опрос об организации питания"></div>
      <div class="field"><label>Описание (необязательно)</label><textarea id="svDesc" placeholder="Краткое описание для участников">${esc(ES.description)}</textarea></div>
    </div>
    <div id="questions"></div>
    <button type="button" class="btn ghost block" id="addQ">＋ Добавить вопрос</button>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn" id="saveBtn">Сохранить</button>
      <a class="btn ghost" href="#/admin/surveys">Отмена</a>
    </div>`);

  document.getElementById('svTitle').addEventListener('input', (e) => { ES.title = e.target.value; });
  document.getElementById('svDesc').addEventListener('input', (e) => { ES.description = e.target.value; });

  const qCont = document.getElementById('questions');
  function drawQuestions() { qCont.innerHTML = ES.questions.map((q, i) => questionHtml(q, i)).join(''); }
  drawQuestions();

  qCont.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.qtext != null) ES.questions[+t.dataset.qtext].text = t.value;
    else if (t.dataset.opt != null && t.dataset.q != null) ES.questions[+t.dataset.q].options[+t.dataset.opt] = t.value;
  });
  qCont.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.qreq != null) ES.questions[+t.dataset.qreq].required = t.checked;
    else if (t.dataset.qtype != null) {
      const q = ES.questions[+t.dataset.qtype];
      q.type = t.value;
      if (q.type === 'text') q.options = [];
      else if (q.options.length === 0) q.options = ['', ''];
      drawQuestions();
    }
  });
  qCont.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.addopt != null) { ES.questions[+btn.dataset.addopt].options.push(''); drawQuestions(); }
    else if (btn.dataset.delopt != null) { ES.questions[+btn.dataset.delopt].options.splice(+btn.dataset.oi, 1); drawQuestions(); }
    else if (btn.dataset.delq != null) {
      ES.questions.splice(+btn.dataset.delq, 1);
      if (ES.questions.length === 0) ES.questions.push(newQuestion());
      drawQuestions();
    }
  });

  document.getElementById('addQ').addEventListener('click', () => { ES.questions.push(newQuestion()); drawQuestions(); });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const errBox = document.getElementById('editorErr');
    try {
      validateEditor();
      const payload = { title: ES.title, description: ES.description, questions: ES.questions };
      if (id) await api('PUT', `/api/admin/surveys/${id}`, payload);
      else await api('POST', '/api/admin/surveys', payload);
      toast('Сохранено');
      location.hash = '#/admin/surveys';
    } catch (e) {
      errBox.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

function validateEditor() {
  if (!ES.title.trim()) throw new Error('Укажите название опроса');
  if (ES.questions.length === 0) throw new Error('Добавьте хотя бы один вопрос');
  for (const q of ES.questions) {
    if (!q.text.trim()) throw new Error('Все вопросы должны иметь текст');
    if (q.type !== 'text') {
      const opts = q.options.filter((o) => o.trim());
      if (opts.length < 2) throw new Error(`Добавьте минимум два варианта ответа в вопросе: «${q.text.trim() || 'без текста'}»`);
    }
  }
}

/* ----- классы ----- */

async function viewClasses(app) {
  if (!await ensureAdmin()) { renderAdminLogin(app); return; }
  const data = await api('GET', '/api/admin/classes');
  const classes = data.classes;
  const list = classes.length ? classes.map((c) => `
    <div class="list-item">
      <div class="grow"><div class="title">${esc(c.name)}</div></div>
      <button class="btn small ghost" data-rename="${c.id}">Переименовать</button>
      <button class="btn small danger ghost" data-del="${c.id}">Удалить</button>
    </div>`).join('') : `<div class="empty"><div class="big">🏫</div>Список классов пуст. Добавьте классы, например «9А», «10Б».</div>`;

  app.innerHTML = adminShell('Классы', 'classes', `
    <div class="card">
      <div class="field"><label>Добавить класс</label>
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
    try { await api('POST', '/api/admin/classes', { name: v }); inp.value = ''; viewClasses(app); }
    catch (e) { toast(e.message); }
  };
  document.getElementById('addClass').addEventListener('click', add);
  document.getElementById('newClass').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  app.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Удалить класс? Уже сохранённые ответы сохранят название класса.')) return;
      try { await api('DELETE', `/api/admin/classes/${b.dataset.del}`); viewClasses(app); }
      catch (e) { toast(e.message); }
    });
  });
  app.querySelectorAll('[data-rename]').forEach((b) => {
    b.addEventListener('click', async () => {
      const c = classes.find((x) => x.id === Number(b.dataset.rename));
      const name = prompt('Новое название класса:', c ? c.name : '');
      if (!name || !name.trim()) return;
      try { await api('PUT', `/api/admin/classes/${b.dataset.rename}`, { name: name.trim() }); viewClasses(app); }
      catch (e) { toast(e.message); }
    });
  });
}

/* ----- отчёт ----- */

async function viewReport(app, id) {
  if (!await ensureAdmin()) { renderAdminLogin(app); return; }
  const data = await api('GET', `/api/admin/surveys/${id}/report`);
  const typeLabel = { single: 'Один вариант', multiple: 'Несколько вариантов', text: 'Свободный ответ' };

  const sections = data.questions.map((q) => {
    let body;
    if (q.type === 'text') {
      const answers = q.answers.length
        ? q.answers.map((a) => `<span class="answer-chip">${esc(a.text)}${a.class ? ` <span class="muted small">(${esc(a.first_name)} ${esc(a.last_name)}, ${esc(a.class)})</span>` : ''}</span>`).join('')
        : '<span class="muted">— ответов нет —</span>';
      body = `<p class="small muted">Всего ответов: ${q.total}</p>${answers}`;
    } else {
      body = q.options.length === 0
        ? '<span class="muted">— нет вариантов —</span>'
        : q.options.map((o) => `
          <div class="bar-row">
            <div class="bar-label"><span>${esc(o.text)}</span><span>${o.count} · ${o.percent}%</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${o.percent}%"></div></div>
          </div>`).join('');
      body = `<p class="small muted">Ответило: ${q.total}</p>${body}`;
    }
    return `<div class="report-q">
      <div class="q-title">${esc(q.text)} <span class="muted small">(${typeLabel[q.type]})</span></div>
      ${body}
    </div>`;
  }).join('');

  app.innerHTML = adminShell('Отчёт', 'surveys', `
    <div class="card">
      <h2>${esc(data.survey.title)}</h2>
      <p class="muted">Всего ответов: ${data.responses_count}</p>
      <div class="btn-row">
        <a class="btn" href="/api/admin/surveys/${id}/export.xlsx">⬇ Excel (.xlsx)</a>
        <a class="btn soft" href="/api/admin/surveys/${id}/export.pdf">⬇ PDF</a>
        <button class="btn ghost" id="toggleInd">Индивидуальные ответы</button>
      </div>
    </div>
    <div class="card">${sections}</div>
    <div id="individual" class="card" style="display:none"></div>
    <p class="center small muted"><a href="#/admin/surveys">← К списку опросов</a></p>`);

  let indLoaded = false;
  document.getElementById('toggleInd').addEventListener('click', async () => {
    const box = document.getElementById('individual');
    if (box.style.display === 'none') {
      if (!indLoaded) {
        box.innerHTML = '<div class="spinner"></div>';
        const d = await api('GET', `/api/admin/surveys/${id}/report/individual`);
        box.innerHTML = renderIndividual(d);
        indLoaded = true;
      }
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  });
}

function renderIndividual(d) {
  if (d.responses.length === 0) return '<div class="empty">Ответов пока нет.</div>';
  const qs = d.survey.questions;
  const head = ['№', 'Имя', 'Фамилия', 'Класс', 'Дата', ...qs.map((q) => q.text)]
    .map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = d.responses.map((r) => {
    const byQ = {};
    for (const a of r.answers) {
      if (!byQ[a.question_id]) byQ[a.question_id] = [];
      byQ[a.question_id].push(a.option_text || a.text_value);
    }
    const cells = [r.id, r.first_name, r.last_name, r.class || '', formatDate(r.created_at),
      ...qs.map((q) => esc((byQ[q.id] || []).join('; ')))];
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }).join('');
  return `<h2>Индивидуальные ответы</h2><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ----- настройки ----- */

async function viewSettings(app) {
  if (!await ensureAdmin()) { renderAdminLogin(app); return; }
  app.innerHTML = adminShell('Настройки', 'settings', `
    <div class="card">
      <h2>Смена пароля администратора</h2>
      <div id="pwErr"></div>
      <div class="field"><label>Текущий пароль</label><input id="cur" type="password" autocomplete="current-password"></div>
      <div class="field"><label>Новый пароль (не менее 6 символов)</label><input id="next" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Повторите новый пароль</label><input id="next2" type="password" autocomplete="new-password"></div>
      <button class="btn" id="savePw">Сменить пароль</button>
    </div>
    <p class="small muted">Пароль хранится в базе данных в виде хэша (scrypt) и не сохраняется в открытом виде.</p>`);

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
}

/* ================= router ================= */

const routes = [
  [/^#\/$/, (m, app) => viewHome(app)],
  [/^#\/login\/(\d+)$/, (m, app) => viewLogin(app, m[1])],
  [/^#\/survey\/(\d+)$/, (m, app) => viewSurvey(app, m[1])],
  [/^#\/done$/, (m, app) => viewDone(app)],
  [/^#\/admin$/, async (m, app) => { if (await ensureAdmin()) location.hash = '#/admin/surveys'; else renderAdminLogin(app); }],
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
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">Страница не найдена.</div><a class="btn" href="#/">На главную</a></div></div>`;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="container"><div class="card"><div class="error-banner">${esc(e.message)}</div><a class="btn" href="#/">На главную</a></div></div>`;
  }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action="logout"]');
  if (el) {
    e.preventDefault();
    try { await api('POST', '/api/admin/logout'); } catch { /* ignore */ }
    location.hash = '#/';
  }
});

window.addEventListener('hashchange', route);
route();
