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

function formatDate(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
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

function adminShell(title, active, contentHtml) {
  const roleLabel = currentRole === 'admin' ? 'Администратор' : 'Редактор';
  const link = (href, label, key) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `
    <header class="app-header">
      <div class="inner">
        <button class="menu-btn" id="menuBtn" aria-label="Меню">☰</button>
        <div class="brand"><img src="/img/logo.jpg" class="brand-logo" alt="">&nbsp;${esc(schoolName)}</div>
        <span class="role-badge">${roleLabel}</span>
      </div>
    </header>
    <div class="admin-layout">
      <aside class="sidebar" id="sidebar">
        <nav>
          ${link('#/admin/surveys', '📋 Опросы', 'surveys')}
          ${link('#/admin/classes', '🏫 Классы', 'classes')}
          ${currentRole === 'admin' ? link('#/admin/settings', '⚙️ Настройки', 'settings') : ''}
          <a href="#" data-action="logout">🚪 Выйти</a>
        </nav>
      </aside>
      <main class="admin-main">
        <h1>${esc(title)}</h1>
        ${contentHtml}
      </main>
    </div>`;
}

function renderAdminLogin(app) {
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

/* ================= респондент ================= */

async function viewHome(app) {
  const data = await api('GET', '/api/bootstrap');
  if (data.school_name) schoolName = data.school_name;
  const surveys = data.surveys || [];
  let cards;
  if (!surveys.length) {
    cards = `<div class="empty"><div class="big">📋</div>Сейчас нет активных опросов.<br>Загляните позже.</div>`;
  } else {
    cards = surveys.map((s) => {
      if (s.state === 'open') {
        return `<a class="survey-card" href="#/login/${s.id}">
          <div class="sc-title">${esc(s.title)}</div>
          ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
          <div class="sc-foot"><span></span><span class="sc-btn">Пройти опрос</span></div>
        </a>`;
      }
      const badge = s.state === 'scheduled'
        ? '<span class="badge scheduled">Скоро откроется</span>'
        : '<span class="badge closed">Завершён</span>';
      return `<div class="survey-card">
        <div class="sc-title">${esc(s.title)}</div>
        ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
        <div class="sc-foot">${badge}</div>
      </div>`;
    }).join('');
  }
  app.innerHTML = `
    <div class="container">
      <div class="hero">
        <img src="/img/logo.jpg" class="hero-logo" alt="Логотип">
        <h1>${esc(schoolName)}</h1>
        <p>Выберите опрос, укажите имя, фамилию и класс — и ответьте на вопросы.</p>
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
  const total = survey.questions.length;
  let idx = 0;
  const answers = {};

  function fillProgress() {
    const done = survey.questions.filter((q) => {
      const a = answers[q.id];
      if (!a) return false;
      return q.type === 'text' ? !!(a.text || '').trim() : (a.option_ids || []).length > 0;
    }).length;
    const fill = document.getElementById('progFill');
    const meta = document.getElementById('progMeta');
    if (fill) fill.style.width = Math.round((done / total) * 100) + '%';
    if (meta) meta.textContent = `Вопрос ${idx + 1} из ${total}`;
  }

  function validateCurrent(q) {
    const a = answers[q.id];
    if (!q.required) return true;
    if (q.type === 'text') return !!(a && a.text || '').trim();
    return (a && a.option_ids && a.option_ids.length > 0);
  }

  function currentHint(q) {
    if (q.type === 'single') return 'Выберите один вариант';
    if (q.type === 'multiple') return 'Выберите хотя бы один вариант';
    return 'Введите ответ';
  }

  function renderQuestion() {
    const q = survey.questions[idx];
    if (!answers[q.id]) answers[q.id] = { option_ids: [], text: '' };
    const a = answers[q.id];
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let body;
    if (q.type === 'text') {
      body = `<textarea id="kText" placeholder="Ваш ответ">${esc(a.text)}</textarea>`;
    } else {
      body = q.options.map((o) => {
        const checked = (a.option_ids || []).includes(o.id);
        return `<label class="option ${checked ? 'selected' : ''}">
          <input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="q${q.id}" value="${o.id}" ${checked ? 'checked' : ''}>
          <span class="opt-text">${esc(o.text)}</span>
        </label>`;
      }).join('');
    }
    const hint = q.type === 'single' ? 'Выберите один вариант' : q.type === 'multiple' ? 'Можно выбрать несколько вариантов' : '';
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
        fillProgress();
      });
    });
    const ta = document.getElementById('kText');
    if (ta) ta.addEventListener('input', () => { a.text = ta.value; fillProgress(); });

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
        const aa = answers[qq.id] || { option_ids: [], text: '' };
        return qq.type === 'text'
          ? { question_id: qq.id, text: aa.text || '' }
          : { question_id: qq.id, option_ids: aa.option_ids || [] };
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
        location.hash = '#/done';
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить ответы';
        showErr(e.message);
        if (/уже проходили|уже отправлен|завершён|не начался/.test(e.message)) {
          sessionStorage.setItem(`done_${id}`, '1');
          setTimeout(() => { location.hash = '#/done'; }, 1600);
        }
      }
    });
  }

  renderQuestion();
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

/* ================= админ: опросы ================= */

async function viewAdminSurveys(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  const data = await api('GET', '/api/admin/surveys');
  const surveys = data.surveys;
  const cards = surveys.length ? surveys.map((s) => {
    const st = clientState(s);
    const badge = st === 'draft' ? '<span class="badge draft">Черновик</span>'
      : st === 'scheduled' ? '<span class="badge scheduled">Скоро</span>'
      : st === 'closed' ? '<span class="badge closed">Завершён</span>'
      : '<span class="badge published">Опубликован</span>';
    let meta = `Вопросов: ${s.questions_count} · Ответов: ${s.responses_count}`;
    if (s.published_at) meta += `<br>Опубликован: ${formatDate(s.published_at)}`;
    if (s.open_at) meta += `<br>Открытие: ${formatDate(s.open_at)}`;
    if (s.close_at) meta += `<br>Закрытие: ${formatDate(s.close_at)}`;
    return `<div class="survey-card">
      <div class="sc-title">${esc(s.title)}</div>
      ${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}
      <div class="sub">${badge} ${meta}</div>
      <div class="btn-row">
        <a class="btn small soft" href="#/admin/report/${s.id}">Отчёт</a>
        <a class="btn small ghost" href="#/admin/survey/${s.id}">Изменить</a>
        <button class="btn small ${s.published ? 'ghost' : 'soft'}" data-toggle="${s.id}" data-pub="${s.published ? 0 : 1}">${s.published ? 'Снять' : 'Опубликовать'}</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><div class="big">📝</div>Пока нет опросов. Нажмите «Новый опрос», чтобы создать.</div>`;

  app.innerHTML = adminShell('Опросы', 'surveys', `
    <div class="btn-row" style="margin-bottom:14px"><a class="btn" href="#/admin/survey/new">＋ Новый опрос</a></div>
    <div class="cards-grid">${cards}</div>`);

  app.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api('POST', `/api/admin/surveys/${b.dataset.toggle}/publish`, { published: b.dataset.pub === '1' });
        viewAdminSurveys(app);
      } catch (e) { toast(e.message, 6000); }
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
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
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
      ? existing.questions.map((q) => ({ text: q.text, type: q.type, required: !!q.required, options: q.options.map((o) => o.text) }))
      : [newQuestion()]
  };

  app.innerHTML = adminShell(id ? 'Редактирование опроса' : 'Новый опрос', 'surveys', `
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
    <button type="button" class="btn ghost block" id="addQ">＋ Добавить вопрос</button>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn" id="saveBtn">Сохранить</button>
      <a class="btn ghost" href="#/admin/surveys">Отмена</a>
    </div>`);

  document.getElementById('svTitle').addEventListener('input', (e) => { ES.title = e.target.value; });
  document.getElementById('svDesc').addEventListener('input', (e) => { ES.description = e.target.value; });
  document.getElementById('svOpen').addEventListener('input', (e) => { ES.open_at = e.target.value || null; });
  document.getElementById('svClose').addEventListener('input', (e) => { ES.close_at = e.target.value || null; });

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
      const payload = { title: ES.title, description: ES.description, questions: ES.questions, open_at: ES.open_at, close_at: ES.close_at };
      if (id) await api('PUT', `/api/admin/surveys/${id}`, payload);
      else await api('POST', '/api/admin/surveys', payload);
      toast('Черновик сохранён');
      location.hash = '#/admin/surveys';
    } catch (e) {
      errBox.innerHTML = `<div class="error-banner">${esc(e.message)}</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/* ----- классы ----- */

async function viewClasses(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
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

const CHART_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b'];

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
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offset += len;
  });
  return `<svg viewBox="0 0 140 140" class="donut" aria-hidden="true">${circles}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" class="donut-center">${total}</text></svg>`;
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
    if (q.type === 'text') {
      const cells = classes.map((c) => `<td>${q.totals[c.id] || 0}</td>`).join('');
      return `<div class="report-q">
        <div class="q-title">${esc(q.text)} <span class="muted small">(свободный ответ — количество)</span></div>
        <div class="table-wrap"><table><thead><tr><th>Класс</th>${classes.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody><tr><td>Ответов</td>${cells}</tr></tbody></table></div>
      </div>`;
    }
    const rows = q.options.map((o) => {
      const cells = classes.map((c) => {
        const cnt = o.counts[c.id] || 0;
        const tot = q.totals[c.id] || 0;
        const pct = tot ? Math.round((cnt / tot) * 100) : 0;
        return `<td>${cnt}${tot ? ` <span class="muted small">(${pct}%)</span>` : ''}</td>`;
      }).join('');
      return `<tr><td>${esc(o.text)}</td>${cells}</tr>`;
    }).join('');
    const totalRow = `<tr><td class="muted">Ответило</td>${classes.map((c) => `<td>${q.totals[c.id] || 0}</td>`).join('')}</tr>`;
    return `<div class="report-q">
      <div class="q-title">${esc(q.text)}</div>
      <div class="table-wrap"><table><thead><tr><th>Вариант</th>${classes.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows}${totalRow}</tbody></table></div>
    </div>`;
  }).join('');
  return `<h2>Разбивка по классам</h2>${sections}`;
}

async function viewReport(app, id) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  const data = await api('GET', `/api/admin/surveys/${id}/report`);
  const classes = data.classes || [];
  const filterOptions = '<option value="">Все классы</option>' +
    classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const sections = data.questions.map(renderQuestionSection).join('');
  const pubMeta = data.survey.published_at ? `<p class="muted">Опубликован: ${formatDate(data.survey.published_at)}</p>` : '';

  app.innerHTML = adminShell('Отчёт', 'surveys', `
    <div class="card">
      <h2>${esc(data.survey.title)}</h2>
      <p class="muted">Всего ответов: ${data.responses_count}</p>
      ${pubMeta}
      <div class="field" style="max-width:280px">
        <label>Класс (фильтр)</label>
        <select id="classFilter">${filterOptions}</select>
      </div>
      <div class="btn-row">
        <a class="btn" href="/api/admin/surveys/${id}/export.xlsx">⬇ Excel (.xlsx)</a>
        <a class="btn soft" href="/api/admin/surveys/${id}/export.pdf">⬇ PDF</a>
        <button class="btn ghost" id="toggleBreakdown">Разбивка по классам</button>
        <button class="btn ghost" id="toggleInd">Индивидуальные ответы</button>
        <button class="btn ghost" id="toggleHist">История публикаций</button>
      </div>
    </div>
    <div id="summaryWrap"><div class="card">${sections}</div></div>
    <div id="breakdown" class="card" style="display:none"></div>
    <div id="individual" class="card" style="display:none"></div>
    <div id="history" class="card" style="display:none"></div>
    <p class="center small muted"><a href="#/admin/surveys">← К списку опросов</a></p>`);

  document.getElementById('classFilter').addEventListener('change', async (e) => {
    const cid = e.target.value;
    try {
      const url = cid ? `/api/admin/surveys/${id}/report?class_id=${cid}` : `/api/admin/surveys/${id}/report`;
      const d = await api('GET', url);
      document.getElementById('summaryWrap').innerHTML = `<div class="card">${d.questions.map(renderQuestionSection).join('')}</div>`;
    } catch (err) { toast(err.message); }
  });

  let bdLoaded = false;
  document.getElementById('toggleBreakdown').addEventListener('click', async () => {
    const box = document.getElementById('breakdown');
    if (box.style.display === 'none') {
      if (!bdLoaded) {
        box.innerHTML = '<div class="spinner"></div>';
        const d = await api('GET', `/api/admin/surveys/${id}/breakdown`);
        box.innerHTML = renderBreakdown(d);
        bdLoaded = true;
      }
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  });

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

  let histLoaded = false;
  document.getElementById('toggleHist').addEventListener('click', async () => {
    const box = document.getElementById('history');
    if (box.style.display === 'none') {
      if (!histLoaded) {
        const d = await api('GET', `/api/admin/surveys/${id}/history`);
        histLoaded = true;
        box.innerHTML = renderHistory(d.history);
      }
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  });
}

function renderHistory(history) {
  if (!history.length) return '<div class="empty">История пуста.</div>';
  const items = history.map((h) => `
    <div class="history-item">
      <span>${h.action === 'publish' ? '✅ Опубликован' : '⛔ Снят с публикации'}</span>
      <span class="muted small">${h.actor === 'editor' ? 'редактор' : 'администратор'} · ${formatDate(h.created_at)}</span>
    </div>`).join('');
  return `<h2>История публикаций</h2><div class="history-list">${items}</div>`;
}

function renderIndividual(d) {
  if (d.responses.length === 0) return '<div class="empty">Ответов пока нет.</div>';
  const qs = d.survey.questions;
  const head = ['№', 'Класс', 'Дата', ...qs.map((q) => q.text)]
    .map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = d.responses.map((r) => {
    const byQ = {};
    for (const a of r.answers) {
      if (!byQ[a.question_id]) byQ[a.question_id] = [];
      byQ[a.question_id].push(a.option_text || a.text_value);
    }
    const cells = [r.id, r.class || '', formatDate(r.created_at),
      ...qs.map((q) => esc((byQ[q.id] || []).join('; ')))];
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }).join('');
  return `<h2>Индивидуальные ответы</h2><p class="small muted">Ответы без персональных данных.</p><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ----- настройки ----- */

async function viewSettings(app) {
  if (!await ensureStaff()) { renderAdminLogin(app); return; }
  if (currentRole !== 'admin') {
    app.innerHTML = adminShell('Доступ запрещён', 'settings', '<div class="error-banner">У вас нет прав для этого раздела.</div>');
    return;
  }
  const s = await api('GET', '/api/admin/settings');

  app.innerHTML = adminShell('Настройки', 'settings', `
    <div class="card">
      <h2>Портал</h2>
      <div class="field"><label>Название школы</label><input id="schoolName" type="text" value="${esc(s.school_name)}"></div>
      <button class="btn" id="saveSchool">Сохранить название</button>
      <p class="small muted" style="margin-top:8px">Логотип и фото школы размещены в файлах public/img/logo.jpg и public/img/photo.jpg.</p>
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
      <p class="small muted">Редактор может создавать и редактировать опросы, управлять классами и смотреть отчёты, но не имеет доступа к настройкам и не может менять пароли.</p>
      <div id="edErr"></div>
      <div class="field"><label>Пароль редактора</label><input id="edPw" type="password" placeholder="${s.editor_enabled ? 'Введите новый пароль редактора' : 'Введите пароль, чтобы включить вход редактора'}"></div>
      <button class="btn ${s.editor_enabled ? '' : 'soft'}" id="saveEditor">${s.editor_enabled ? 'Изменить пароль редактора' : 'Включить вход редактора'}</button>
      ${s.editor_enabled ? '<button class="btn danger ghost" id="disableEditor" style="margin-left:8px">Отключить вход редактора</button>' : ''}
    </div>
    <p class="small muted">Пароли хранятся в базе данных в виде хэша (scrypt) и не сохраняются в открытом виде.</p>`);

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
  [/^#\/admin$/, async (m, app) => { if (await ensureStaff()) location.hash = '#/admin/surveys'; else renderAdminLogin(app); }],
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
