'use strict';
// Сквозной тест API. Запускать после старта сервера.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3210';

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
  else { data = Buffer.from(await res.arrayBuffer()); }
  return { status: res.status, data, ct };
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
  console.log('Сервер доступен.');

  // 1. пустой bootstrap
  let r = await req('GET', '/api/bootstrap');
  check('bootstrap 200', r.status === 200 && Array.isArray(r.data.surveys) && Array.isArray(r.data.classes));

  // 2. неверный пароль
  r = await req('POST', '/api/admin/login', { password: 'wrong' });
  check('неверный пароль -> 401', r.status === 401);

  // 3. верный пароль
  r = await req('POST', '/api/admin/login', { password: 'admin123' });
  check('вход администратора -> 200', r.status === 200);
  r = await req('GET', '/api/admin/me');
  check('admin/me authed', r.data && r.data.authed === true);

  // 4. классы
  r = await req('POST', '/api/admin/classes', { name: '9А' });
  check('создать класс 9А', r.status === 200 && r.data.class && r.data.class.id);
  const classA = r.data.class.id;
  r = await req('POST', '/api/admin/classes', { name: '10Б' });
  check('создать класс 10Б', r.status === 200);
  r = await req('GET', '/api/admin/classes');
  check('список классов = 2', r.data.classes.length === 2);

  // 5. создание опроса
  const surveyPayload = {
    title: 'Тестовый опрос',
    description: 'Проверка работы',
    questions: [
      { text: 'Любимый предмет?', type: 'single', required: true, options: ['Математика', 'Литература', 'История'] },
      { text: 'Какие кружки посещаете?', type: 'multiple', required: true, options: ['Спорт', 'Музыка', 'Рисование'] },
      { text: 'Пожелания', type: 'text', required: false, options: [] }
    ]
  };
  r = await req('POST', '/api/admin/surveys', surveyPayload);
  check('создать опрос', r.status === 200 && r.data.survey.id);
  const surveyId = r.data.survey.id;
  check('вопросов 3', r.data.survey.questions.length === 3);

  // 6. опрос не опубликован -> недоступен
  r = await req('GET', `/api/survey/${surveyId}`);
  check('черновик недоступен публично', r.status === 404);

  // 6.5 сохранение без жёсткой проверки + проверка при публикации
  const draft = {
    title: 'Черновик с неполным вопросом',
    description: '',
    questions: [{ text: 'Неполный вопрос?', type: 'single', required: true, options: ['Только один вариант'] }]
  };
  r = await req('POST', '/api/admin/surveys', draft);
  check('сохранить черновик с 1 вариантом -> 200', r.status === 200);
  const draftId = r.data.survey.id;
  check('черновик: вариант сохранён строкой', r.data.survey.questions[0].options.length === 1 && r.data.survey.questions[0].options[0].text === 'Только один вариант');
  r = await req('POST', `/api/admin/surveys/${draftId}/publish`, { published: true });
  check('опубликовать неполный -> 400', r.status === 400);
  r = await req('POST', '/api/admin/surveys', { title: '', description: '', questions: [] });
  check('сохранить без названия -> 200 (Без названия)', r.status === 200 && r.data.survey.title === 'Без названия');

  // 7. публикация
  r = await req('POST', `/api/admin/surveys/${surveyId}/publish`, { published: true });
  check('опубликовать', r.status === 200 && r.data.survey.published === 1);
  r = await req('GET', `/api/survey/${surveyId}`);
  check('опубликованный опрос доступен', r.status === 200 && r.data.questions.length === 3);

  // 8. отправка без имени -> 400
  r = await req('POST', `/api/survey/${surveyId}/submit`, { first_name: '', last_name: '', class_id: classA, answers: [] });
  check('без ФИО -> 400', r.status === 400);

  // 9. отправка ответа (получим id вопросов из опроса)
  const sv = (await req('GET', `/api/survey/${surveyId}`)).data;
  const qs = sv.questions;
  const submit = {
    first_name: 'Иван', last_name: 'Иванов', class_id: classA,
    answers: [
      { question_id: qs[0].id, option_ids: [qs[0].options[0].id] },
      { question_id: qs[1].id, option_ids: [qs[1].options[0].id, qs[1].options[1].id] },
      { question_id: qs[2].id, text: 'Больше перемен' }
    ]
  };
  r = await req('POST', `/api/survey/${surveyId}/submit`, submit);
  check('отправить ответ -> 200', r.status === 200);

  // 10. повторная отправка (cookie) -> 409
  r = await req('POST', `/api/survey/${surveyId}/submit`, submit);
  check('повтор с cookie -> 409', r.status === 409);

  // 11. повтор с тем же ФИО+класс (новая сессия без cookie)
  const jarBackup = { ...jar };
  delete jar[`taken_${surveyId}`];
  r = await req('POST', `/api/survey/${surveyId}/submit`, submit);
  check('повтор с тем же ФИО+класс -> 409', r.status === 409);
  jar = jarBackup;

  // 12. отчёт
  r = await req('GET', `/api/admin/surveys/${surveyId}/report`);
  check('отчёт: 1 ответ', r.status === 200 && r.data.responses_count === 1);
  const q0 = r.data.questions[0];
  check('сводка: вариант имеет count=1, percent=100', q0.options.some((o) => o.count === 1 && o.percent === 100));

  // 13. индивидуальные ответы (без персональных данных)
  r = await req('GET', `/api/admin/surveys/${surveyId}/report/individual`);
  check('индивидуальные: 1 запись', r.status === 200 && r.data.responses.length === 1);
  check('индивидуальные: без имени/фамилии', r.data.responses[0].first_name === undefined && r.data.responses[0].last_name === undefined && r.data.responses[0].ip === undefined);

  // 13.1 анонимизация текстовых ответов
  const textQ = r.data.survey.questions.find((q) => q.type === 'text');
  if (textQ) {
    const s2 = (await req('GET', `/api/admin/surveys/${surveyId}/report`)).data;
    const tq = s2.questions.find((q) => q.type === 'text');
    check('сводка: текстовый ответ без имени', tq.answers.length === 1 && tq.answers[0].first_name === undefined && tq.answers[0].text === 'Больше перемен');
  }

  // 13.2 разбивка по классам
  r = await req('GET', `/api/admin/surveys/${surveyId}/breakdown`);
  check('разбивка: классы есть', r.status === 200 && r.data.classes.length === 1 && r.data.classes[0].name === '9А');
  const bq = r.data.questions.find((q) => q.type === 'single');
  check('разбивка: вариант с количеством по классу', bq.options.some((o) => (o.counts[classA] || 0) === 1));

  // 13.3 фильтр по классу
  r = await req('GET', `/api/admin/surveys/${surveyId}/report?class_id=${classA}`);
  check('фильтр по классу: 1 ответ', r.status === 200 && r.data.responses_count === 1);

  // 13.5 защита: нельзя менять вопросы при наличии ответов
  const modifiedQ = JSON.parse(JSON.stringify(surveyPayload));
  modifiedQ.questions[0].text = 'Другой вопрос?';
  modifiedQ.title = 'Изменённый';
  r = await req('PUT', `/api/admin/surveys/${surveyId}`, modifiedQ);
  check('изменить вопросы при наличии ответов -> 400', r.status === 400);
  const fetched = (await req('GET', `/api/admin/surveys/${surveyId}`)).data.survey;
  r = await req('PUT', `/api/admin/surveys/${surveyId}`, { title: 'Новое название', description: 'обновлено', questions: fetched.questions });
  check('изменить только название -> 200', r.status === 200 && r.data.survey.title === 'Новое название');

  // 14. экспорты
  r = await req('GET', `/api/admin/surveys/${surveyId}/export.xlsx`);
  check('xlsx: 200 + magic PK', r.status === 200 && r.data.slice(0, 2).toString('ascii') === 'PK');
  r = await req('GET', `/api/admin/surveys/${surveyId}/export.pdf`);
  check('pdf: 200 + magic %PDF', r.status === 200 && r.data.slice(0, 4).toString('ascii') === '%PDF');

  // 15. смена пароля
  r = await req('POST', '/api/admin/change-password', { current: 'admin123', next: 'newpass123' });
  check('смена пароля -> 200', r.status === 200);
  r = await req('POST', '/api/admin/logout', {});
  jar = {};
  r = await req('POST', '/api/admin/login', { password: 'admin123' });
  check('старый пароль не работает -> 401', r.status === 401);
  r = await req('POST', '/api/admin/login', { password: 'newpass123' });
  check('новый пароль работает -> 200', r.status === 200);

  // 16. роль редактора
  r = await req('POST', '/api/admin/editor-password', { next: 'editor123' });
  check('задать пароль редактора -> 200', r.status === 200);
  r = await req('GET', '/api/admin/settings');
  check('настройки (админ) -> 200 и editor_enabled', r.status === 200 && r.data.editor_enabled === true);
  r = await req('POST', '/api/admin/settings', { school_name: 'Школа № 197' });
  check('сохранить название школы -> 200', r.status === 200);
  r = await req('POST', '/api/admin/logout', {});
  jar = {};
  r = await req('POST', '/api/admin/login', { password: 'editor123' });
  check('вход редактора -> 200 role=editor', r.status === 200 && r.data.role === 'editor');
  r = await req('GET', '/api/admin/me');
  check('me: role=editor', r.data.role === 'editor');
  r = await req('POST', '/api/admin/change-password', { current: 'editor123', next: 'hack123' });
  check('редактор не меняет пароль -> 401', r.status === 401);
  r = await req('GET', '/api/admin/settings');
  check('редактор не видит настройки -> 401', r.status === 401);
  r = await req('POST', '/api/admin/surveys', { title: 'Опрос редактора', questions: [{ text: 'Вопрос?', type: 'single', options: ['А', 'Б'] }] });
  check('редактор создаёт опрос -> 200', r.status === 200);

  // 17. расписание публикации (возвращаемся админом)
  r = await req('POST', '/api/admin/logout', {});
  jar = {};
  await req('POST', '/api/admin/login', { password: 'newpass123' });
  r = await req('POST', '/api/admin/surveys', { title: 'Завершённый', questions: [{ text: 'В?', type: 'text', options: [] }], close_at: '2000-01-01T00:00' });
  const closedId = r.data.survey.id;
  r = await req('POST', `/api/admin/surveys/${closedId}/publish`, { published: true });
  check('публикация завершённого опроса -> 200', r.status === 200);
  r = await req('GET', `/api/survey/${closedId}`);
  check('закрытый опрос недоступен (404 завершён)', r.status === 404 && /завершён/i.test(r.data.error));
  r = await req('POST', '/api/admin/surveys', { title: 'Будущий', questions: [{ text: 'В?', type: 'text', options: [] }], open_at: '2099-01-01T00:00' });
  const futureId = r.data.survey.id;
  r = await req('POST', `/api/admin/surveys/${futureId}/publish`, { published: true });
  r = await req('GET', `/api/survey/${futureId}`);
  check('будущий опрос недоступен (404 не начался)', r.status === 404 && /не начался/i.test(r.data.error));
  r = await req('GET', `/api/admin/surveys/${closedId}/history`);
  check('история публикаций непустая', r.status === 200 && r.data.history.length >= 1);
  const closedSurvey = (await req('GET', `/api/admin/surveys/${closedId}`)).data.survey;
  check('published_at проставлен', !!closedSurvey.published_at);

  // 18. тип «шкала»
  r = await req('POST', '/api/admin/surveys', {
    title: 'Опрос со шкалой',
    questions: [
      { text: 'Оцени питание', type: 'scale', required: true, scale_max: 10, options: [] },
      { text: 'Оцени перемены', type: 'scale', required: false, options: [] }
    ]
  });
  const scaleId = r.data.survey.id;
  check('создать опрос со шкалой', r.status === 200 && r.data.survey.questions[0].type === 'scale' && r.data.survey.questions[0].scale_max === 10);
  r = await req('POST', `/api/admin/surveys/${scaleId}/publish`, { published: true });
  check('опубликовать шкалу без вариантов -> 200', r.status === 200);
  const scaleQs = (await req('GET', `/api/survey/${scaleId}`)).data.questions;
  r = await req('POST', `/api/survey/${scaleId}/submit`, {
    first_name: 'Оля', last_name: 'Оценкина', class_id: classA,
    answers: [{ question_id: scaleQs[0].id, scale: 8 }, { question_id: scaleQs[1].id, scale: 999 }]
  });
  check('отправить шкалу (вторая оценка вне диапазона отброшена) -> 200', r.status === 200);
  delete jar[`taken_${scaleId}`];
  r = await req('POST', `/api/survey/${scaleId}/submit`, {
    first_name: 'Петр', last_name: 'Пятёркин', class_id: classA,
    answers: [{ question_id: scaleQs[1].id, scale: 5 }]
  });
  check('обязательная шкала без ответа -> 400', r.status === 400 && /оценку/i.test(r.data.error));
  const scaleReport = (await req('GET', `/api/admin/surveys/${scaleId}/report`)).data;
  const sq = scaleReport.questions[0];
  check('отчёт по шкале: средняя 8, распределение 10 значений', sq.average === 8 && sq.distribution.length === 10 && sq.distribution[7].count === 1);
  const bdScale = (await req('GET', `/api/admin/surveys/${scaleId}/breakdown`)).data;
  check('разбивка по классам: средняя шкалы по классу', bdScale.questions[0].averages[classA] === 8);

  // 19. дублирование опроса
  r = await req('POST', `/api/admin/surveys/${surveyId}/duplicate`);
  check('дубликат -> 200 черновик с теми же вопросами', r.status === 200 && r.data.survey.published === 0 && r.data.survey.title.endsWith('(копия)') && r.data.survey.questions.length === 3);
  const dupId = r.data.survey.id;
  r = await req('DELETE', `/api/admin/surveys/${dupId}`);
  check('удалить опрос -> 200', r.status === 200);
  r = await req('GET', `/api/admin/surveys/${dupId}`);
  check('удалённый опрос -> 404', r.status === 404);

  // 20. участники: только администратору
  r = await req('GET', `/api/admin/surveys/${surveyId}/participants`);
  check('участники (админ) -> 200 с ФИО', r.status === 200 && r.data.participants.length === 1 && r.data.participants[0].first_name === 'Иван' && r.data.by_class.length === 1);
  const editorJar = { ...jar };
  jar = {};
  await req('POST', '/api/admin/login', { password: 'editor123' });
  r = await req('GET', `/api/admin/surveys/${surveyId}/participants`);
  check('участники (редактор) -> 401', r.status === 401);
  jar = editorJar;

  // 21. дашборд
  r = await req('GET', '/api/admin/dashboard');
  check('дашборд: счётчики и 14 дней', r.status === 200 && typeof r.data.responses_total === 'number' && r.data.by_day.length === 14 && Array.isArray(r.data.top));

  // 22. массовое создание классов
  r = await req('POST', '/api/admin/classes', { names: ['ЕГЭ-класс', '9А', '11Б'] });
  check('bulk-классы: создан только новый', r.status === 200 && r.data.created.length === 2);
  const allClasses = (await req('GET', '/api/admin/classes')).data.classes;
  check('класс: счётчик ответов присутствует', allClasses.every((c) => typeof c.responses_count === 'number'));
  const idxOf = (name) => allClasses.findIndex((c) => c.name === name);
  check('классы: естественная сортировка 9А < 10Б < 11Б', idxOf('9А') < idxOf('10Б') && idxOf('10Б') < idxOf('11Б'));

  // 23. короткая ссылка /s/:id -> редирект на опрос
  {
    const res = await fetch(BASE + `/s/${surveyId}`, { redirect: 'manual' });
    check('/s/:id -> 302 на /#/login/:id', res.status === 302 && (res.headers.get('location') || '') === `/#/login/${surveyId}`);
  }

  // 24. bootstrap: метаданные карточек
  r = await req('GET', '/api/bootstrap');
  const openCard = r.data.surveys.find((s) => s.id === surveyId);
  check('bootstrap: questions_count у опроса', openCard && openCard.questions_count === 3 && openCard.state === 'open');

  // 25. загрузка изображений: только JPEG; валидный JPEG принимается и раздаётся
  r = await req('POST', '/api/admin/upload?kind=logo', 'not an image at all');
  check('upload: не-JPEG -> 400', r.status === 400);
  {
    const fs = require('fs');
    const path = require('path');
    const jpeg = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'logo.jpg'));
    const res = await fetch(BASE + '/api/admin/upload?kind=logo', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', Cookie: cookieHeader() },
      body: jpeg
    });
    const data = await res.json().catch(() => null);
    check('upload: валидный JPEG -> 200 ok', res.status === 200 && data && data.ok === true, data);
    const served = await fetch(BASE + '/img/logo.jpg');
    check('upload: файл раздаётся того же размера', served.status === 200 && (await served.arrayBuffer()).byteLength === jpeg.length);
  }

  console.log(`\nИТОГО: ${pass} прошло, ${fail} упало`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
