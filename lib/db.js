'use strict';

/**
 * Слой работы с базой данных SQLite (встроенный модуль node:sqlite).
 * Без внешних зависимостей.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.SURVEY_DB || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);

// Включаем внешние ключи и журнал для надёжности.
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS surveys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  published    INTEGER NOT NULL DEFAULT 0,
  open_at      TEXT,
  close_at     TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publish_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id  INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  type      TEXT NOT NULL CHECK(type IN ('single','multiple','text','scale')),
  required  INTEGER NOT NULL DEFAULT 1,
  scale_max INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id  INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(survey_id, name_key, class_id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip       TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id   INTEGER REFERENCES options(id) ON DELETE CASCADE,
  text_value  TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions(survey_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_response ON answers(response_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_publish_log_survey ON publish_log(survey_id);
`);

// Миграция для уже существующих БД: добавляем колонки расписания, если их нет.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('surveys', 'open_at', 'open_at TEXT');
ensureColumn('surveys', 'close_at', 'close_at TEXT');
ensureColumn('surveys', 'published_at', 'published_at TEXT');

// Миграция на тип «шкала»: CHECK-ограничение нельзя изменить ALTER'ом,
// поэтому пересоздаём таблицу questions с сохранением всех строк и id.
// Ответы (answers) ссылаются на questions по имени — после переименования
// связь восстанавливается; cascade при переносе не срабатывает, т.к. на время
// миграции внешние ключи выключены.
(function migrateQuestionsScale() {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'questions'"
  ).get();
  if (!row || /'scale'/.test(row.sql)) return; // уже новая схема
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE questions_migrated (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL,
        text      TEXT NOT NULL,
        type      TEXT NOT NULL CHECK(type IN ('single','multiple','text','scale')),
        required  INTEGER NOT NULL DEFAULT 1,
        scale_max INTEGER NOT NULL DEFAULT 5
      );
      INSERT INTO questions_migrated(id, survey_id, position, text, type, required, scale_max)
        SELECT id, survey_id, position, text, type, required, 5 FROM questions;
      DROP TABLE questions;
      ALTER TABLE questions_migrated RENAME TO questions;
    `);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions(survey_id);');
})();

/* ---------- настройки ---------- */

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/* ---------- классы ---------- */

// Естественная сортировка: «9А, 9Б, 10А, 11В», а не «10А, 11В, 9А, 9Б».
// CAST отсекает нечисловой хвост, поэтому «9А» -> 9, «10Б» -> 10.
function listClasses() {
  return db.prepare(`
    SELECT c.id, c.name, c.sort,
           (SELECT COUNT(*) FROM responses r WHERE r.class_id = c.id) AS responses_count
    FROM classes c
    ORDER BY CAST(c.name AS INTEGER) ASC, c.name ASC
  `).all();
}

function createClass(name) {
  const n = String(name).trim();
  if (!n) throw new Error('Название класса не может быть пустым');
  const info = db.prepare('INSERT INTO classes(name, sort) VALUES(?, ?)').run(n, 0);
  return getClass(Number(info.lastInsertRowid));
}

// Массовое создание: «9А, 9Б, 10А» одной строкой. Дубликаты молча пропускаем.
function createClasses(names) {
  const created = [];
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (!n) continue;
    try {
      created.push(createClass(n));
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
  return created;
}

function getClass(id) {
  return db.prepare('SELECT id, name, sort FROM classes WHERE id = ?').get(id);
}

function renameClass(id, name) {
  const n = String(name).trim();
  if (!n) throw new Error('Название класса не может быть пустым');
  db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(n, id);
  return getClass(id);
}

function deleteClass(id) {
  db.prepare('DELETE FROM classes WHERE id = ?').run(id);
}

/* ---------- опросы ---------- */

function listSurveys(withCounts = false) {
  if (!withCounts) {
    return db.prepare(
      'SELECT id, title, description, published, open_at, close_at, published_at, created_at, updated_at FROM surveys ORDER BY id DESC'
    ).all();
  }
  return db.prepare(`
    SELECT s.id, s.title, s.description, s.published, s.open_at, s.close_at, s.published_at, s.created_at, s.updated_at,
           (SELECT COUNT(*) FROM questions q WHERE q.survey_id = s.id) AS questions_count,
           (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS responses_count
    FROM surveys s
    ORDER BY s.id DESC
  `).all();
}

function getSurvey(id) {
  const s = db.prepare(
    'SELECT id, title, description, published, open_at, close_at, published_at, created_at, updated_at FROM surveys WHERE id = ?'
  ).get(id);
  if (!s) return null;
  s.questions = db.prepare(
    'SELECT id, position, text, type, required, scale_max FROM questions WHERE survey_id = ? ORDER BY position ASC, id ASC'
  ).all(id);
  for (const q of s.questions) {
    q.options = db.prepare(
      'SELECT id, position, text FROM options WHERE question_id = ? ORDER BY position ASC, id ASC'
    ).all(q.id);
  }
  return s;
}

function createSurvey({ title, description, questions, open_at, close_at }) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Название опроса не может быть пустым');
  db.exec('BEGIN');
  try {
    const info = db.prepare(
      'INSERT INTO surveys(title, description, open_at, close_at) VALUES(?, ?, ?, ?)'
    ).run(t, String(description || '').trim(), normalizeDateTime(open_at), normalizeDateTime(close_at));
    const surveyId = Number(info.lastInsertRowid);
    insertQuestions(surveyId, questions || []);
    db.exec('COMMIT');
    return getSurvey(surveyId);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Текст варианта ответа: принимает и строку, и объект {text}. Убирает лишние пробелы.
function optionText(o) {
  if (o === null || o === undefined) return '';
  if (typeof o === 'object') return String(o.text || '').trim();
  return String(o).trim();
}

function questionsEqual(a, b) {
  const listA = a || [];
  const listB = b || [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const x = listA[i];
    const y = listB[i];
    if (!y) return false;
    if (String(x.text || '').trim() !== String(y.text || '').trim()) return false;
    if (x.type !== y.type) return false;
    if (!!x.required !== !!y.required) return false;
    if (x.type === 'scale' && Number(x.scale_max || 5) !== Number(y.scale_max || 5)) return false;
    if (x.type !== 'text') {
      const xo = (x.options || []).map(optionText);
      const yo = (y.options || []).map(optionText);
      if (xo.length !== yo.length || xo.some((v, j) => v !== yo[j])) return false;
    }
  }
  return true;
}

function updateSurvey(id, { title, description, questions, open_at, close_at }) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Название опроса не может быть пустым');
  const existing = getSurvey(id);
  if (!existing) throw new Error('Опрос не найден');
  const newQs = questions || [];
  const same = questionsEqual(existing.questions, newQs);
  const respCount = Number(
    db.prepare('SELECT COUNT(*) AS c FROM responses WHERE survey_id = ?').get(id).c
  );
  // Защита целостности: если уже есть ответы, менять вопросы нельзя
  // (иначе каскадное удаление вопросов удалит и связанные ответы).
  if (respCount > 0 && !same) {
    throw new Error('На опрос уже есть ответы, поэтому вопросы изменять нельзя. Создайте новый опрос.');
  }
  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE surveys SET title = ?, description = ?, open_at = ?, close_at = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(t, String(description || '').trim(), normalizeDateTime(open_at), normalizeDateTime(close_at), id);
    if (!same) {
      db.prepare('DELETE FROM questions WHERE survey_id = ?').run(id);
      insertQuestions(id, newQs);
    }
    db.exec('COMMIT');
    return getSurvey(id);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function insertQuestions(surveyId, questions) {
  let pos = 0;
  for (const q of questions || []) {
    const text = String(q.text || '').trim();
    const type = ['single', 'multiple', 'text', 'scale'].includes(q.type) ? q.type : 'single';
    if (!text) continue;
    pos += 1;
    const scaleMax = type === 'scale' ? (Number(q.scale_max) === 10 ? 10 : 5) : 5;
    const info = db.prepare(
      'INSERT INTO questions(survey_id, position, text, type, required, scale_max) VALUES(?,?,?,?,?,?)'
    ).run(surveyId, pos, text, type, q.required ? 1 : 0, scaleMax);
    const qid = Number(info.lastInsertRowid);
    if (type !== 'text' && type !== 'scale') {
      let opos = 0;
      for (const o of q.options || []) {
        const otext = optionText(o);
        if (!otext) continue;
        opos += 1;
        db.prepare(
          'INSERT INTO options(question_id, position, text) VALUES(?,?,?)'
        ).run(qid, opos, otext);
      }
    }
  }
}

function setPublished(id, published, actor) {
  const existing = getSurvey(id);
  if (!existing) throw new Error('Опрос не найден');
  if (published) {
    db.prepare(
      'UPDATE surveys SET published = 1, published_at = COALESCE(published_at, datetime(\'now\')), updated_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  } else {
    db.prepare(
      'UPDATE surveys SET published = 0, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  }
  db.prepare(
    'INSERT INTO publish_log(survey_id, action, actor) VALUES(?, ?, ?)'
  ).run(id, published ? 'publish' : 'unpublish', actor || null);
  return getSurvey(id);
}

function deleteSurvey(id) {
  db.prepare('DELETE FROM surveys WHERE id = ?').run(id);
}

// Копия опроса как черновик: вопросы переносятся, расписание сбрасывается.
function duplicateSurvey(id) {
  const s = getSurvey(id);
  if (!s) throw new Error('Опрос не найден');
  return createSurvey({
    title: s.title + ' (копия)',
    description: s.description,
    open_at: null,
    close_at: null,
    questions: s.questions.map((q) => ({
      text: q.text,
      type: q.type,
      required: !!q.required,
      scale_max: q.scale_max,
      options: q.options.map((o) => o.text)
    }))
  });
}

// Приводим строку из <input type="datetime-local"> ("YYYY-MM-DDTHH:MM") к "YYYY-MM-DD HH:MM".
function normalizeDateTime(s) {
  if (!s) return null;
  const t = String(s).trim().replace('T', ' ');
  return t || null;
}

// Доступность опроса: draft | scheduled | open | closed.
// Время трактуется в часовом поясе сервера.
function surveyState(survey, now = new Date()) {
  if (!survey.published) return 'draft';
  const parse = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);
  const open = parse(survey.open_at);
  const close = parse(survey.close_at);
  if (open && now < open) return 'scheduled';
  if (close && now >= close) return 'closed';
  return 'open';
}

function getPublishHistory(surveyId) {
  return db.prepare(
    'SELECT id, action, actor, created_at FROM publish_log WHERE survey_id = ? ORDER BY id DESC'
  ).all(surveyId);
}

/* ---------- ответы ---------- */

function normalizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function nameKey(first, last) {
  return normalizeName(first) + '|' + normalizeName(last);
}

// classId может быть null (режим CLASSES_ENABLED=0). В SQLite UNIQUE считает
// NULL ≠ NULL, поэтому дедупликацию «имя+фамилия+класс» делаем запросом
// с явным сравнением NULL — иначе без классов один ученик отвечал бы повторно.
function findExistingResponse(surveyId, firstName, lastName, classId) {
  return db.prepare(`
    SELECT id, first_name, last_name, created_at FROM responses
    WHERE survey_id = ? AND name_key = ?
      AND ((? IS NULL AND class_id IS NULL) OR class_id = ?)
  `).get(surveyId, nameKey(firstName, lastName), classId, classId);
}

function countResponsesByIp(surveyId, ip) {
  if (!ip) return 0;
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM responses WHERE survey_id = ? AND ip = ?'
  ).get(surveyId, ip);
  return Number(row.c);
}

function saveResponse(surveyId, firstName, lastName, classId, ip, answers) {
  const key = nameKey(firstName, lastName);
  const info = db.prepare(
    'INSERT INTO responses(survey_id, first_name, last_name, name_key, class_id, ip) VALUES(?,?,?,?,?,?)'
  ).run(surveyId, String(firstName).trim(), String(lastName).trim(), key, classId, ip || null);
  const responseId = Number(info.lastInsertRowid);

  for (const a of answers || []) {
    const q = db.prepare(
      'SELECT type, scale_max FROM questions WHERE id = ? AND survey_id = ?'
    ).get(a.question_id, surveyId);
    if (!q) continue;
    if (q.type === 'text') {
      const tv = String(a.text || '').trim();
      if (!tv) continue;
      db.prepare(
        'INSERT INTO answers(response_id, question_id, text_value) VALUES(?,?,?)'
      ).run(responseId, a.question_id, tv);
    } else if (q.type === 'scale') {
      // Оценка хранится в text_value строкой («4»); пусто = не отвечено.
      const v = Number(a.scale != null ? a.scale : a.text);
      if (!Number.isInteger(v) || v < 1 || v > (q.scale_max || 5)) continue;
      db.prepare(
        'INSERT INTO answers(response_id, question_id, text_value) VALUES(?,?,?)'
      ).run(responseId, a.question_id, String(v));
    } else {
      const opts = Array.isArray(a.option_ids) ? a.option_ids : (a.option_ids ? [a.option_ids] : []);
      for (const oid of opts) {
        db.prepare(
          'INSERT INTO answers(response_id, question_id, option_id) VALUES(?,?,?)'
        ).run(responseId, a.question_id, oid);
      }
    }
  }
  return responseId;
}

/* ---------- отчёты ---------- */

function responseClasses(surveyId) {
  return db.prepare(`
    SELECT DISTINCT cl.id, cl.name
    FROM responses r
    JOIN classes cl ON cl.id = r.class_id
    WHERE r.survey_id = ?
    ORDER BY cl.sort ASC, cl.name ASC
  `).all(surveyId);
}

// Сводка по опросу. classId — необязательный фильтр по классу.
// В отчёте НЕ возвращаются персональные данные (имя/фамилия/IP).
function getSummary(surveyId, classId) {
  const survey = getSurvey(surveyId);
  if (!survey) return null;
  const cid = classId ? Number(classId) : null;
  const respCount = db.prepare(
    'SELECT COUNT(*) AS c FROM responses r WHERE r.survey_id = ? AND (? IS NULL OR r.class_id = ?)'
  ).get(surveyId, cid, cid).c;

  const questions = [];
  for (const q of survey.questions) {
    const item = { id: q.id, text: q.text, type: q.type, required: !!q.required };
    if (q.type === 'text') {
      item.answers = db.prepare(`
        SELECT a.text_value AS text, cl.name AS class
        FROM answers a
        JOIN responses r ON r.id = a.response_id
        LEFT JOIN classes cl ON cl.id = r.class_id
        WHERE a.question_id = ? AND r.survey_id = ? AND a.text_value IS NOT NULL AND a.text_value != ''
          AND (? IS NULL OR r.class_id = ?)
        ORDER BY r.id ASC
      `).all(q.id, surveyId, cid, cid);
      item.total = item.answers.length;
    } else if (q.type === 'scale') {
      const rows = db.prepare(`
        SELECT a.text_value AS v
        FROM answers a
        JOIN responses r ON r.id = a.response_id
        WHERE a.question_id = ? AND r.survey_id = ? AND a.text_value IS NOT NULL
          AND (? IS NULL OR r.class_id = ?)
      `).all(q.id, surveyId, cid, cid);
      const max = q.scale_max || 5;
      const counts = new Array(max + 1).fill(0);
      let sum = 0;
      for (const row of rows) {
        const v = Number(row.v);
        if (!Number.isInteger(v) || v < 1 || v > max) continue;
        counts[v] += 1;
        sum += v;
      }
      item.total = counts.reduce((a, b) => a + b, 0);
      item.scale_max = max;
      item.average = item.total ? Math.round((sum / item.total) * 10) / 10 : null;
      item.distribution = [];
      for (let v = 1; v <= max; v++) {
        item.distribution.push({
          value: v,
          count: counts[v],
          percent: item.total > 0 ? Math.round((counts[v] / item.total) * 1000) / 10 : 0
        });
      }
    } else {
      item.total = db.prepare(`
        SELECT COUNT(DISTINCT a.response_id) AS c
        FROM answers a
        JOIN responses r ON r.id = a.response_id
        WHERE a.question_id = ? AND r.survey_id = ? AND (? IS NULL OR r.class_id = ?)
      `).get(q.id, surveyId, cid, cid).c;
      item.options = [];
      for (const o of q.options) {
        const count = db.prepare(`
          SELECT COUNT(*) AS c FROM answers a
          JOIN responses r ON r.id = a.response_id
          WHERE a.question_id = ? AND a.option_id = ? AND r.survey_id = ? AND (? IS NULL OR r.class_id = ?)
        `).get(q.id, o.id, surveyId, cid, cid).c;
        item.options.push({
          id: o.id,
          text: o.text,
          count,
          percent: item.total > 0 ? Math.round((count / item.total) * 1000) / 10 : 0
        });
      }
    }
    questions.push(item);
  }

  // Ответы по дням (для мини-графика активности). created_at хранится в UTC,
  // день считаем в часовом поясе сервера.
  const byDayRows = db.prepare(
    'SELECT created_at FROM responses WHERE survey_id = ? AND (? IS NULL OR class_id = ?) ORDER BY created_at ASC'
  ).all(surveyId, cid, cid);
  const byDayMap = new Map();
  for (const row of byDayRows) {
    const d = new Date(String(row.created_at).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString('sv-SE');
    byDayMap.set(key, (byDayMap.get(key) || 0) + 1);
  }
  const by_day = [...byDayMap.entries()].map(([date, count]) => ({ date, count }));

  return { survey, responses_count: respCount, classes: responseClasses(surveyId), questions, by_day };
}

// Индивидуальные ответы без персональных данных (только класс, дата и ответы).
function getIndividualAnswers(surveyId) {
  const responses = db.prepare(`
    SELECT r.id, cl.name AS class, r.created_at
    FROM responses r
    LEFT JOIN classes cl ON cl.id = r.class_id
    WHERE r.survey_id = ?
    ORDER BY r.id ASC
  `).all(surveyId);
  for (const r of responses) {
    r.answers = db.prepare(`
      SELECT a.question_id, a.option_id, a.text_value,
             q.text AS question_text, q.type AS question_type,
             o.text AS option_text
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      LEFT JOIN options o ON o.id = a.option_id
      WHERE a.response_id = ?
      ORDER BY q.position ASC, o.position ASC
    `).all(r.id);
  }
  return responses;
}

// Разбивка ответов по классам: для каждого вопроса — счётчики вариантов по классам.
function getBreakdown(surveyId) {
  const survey = getSurvey(surveyId);
  if (!survey) return null;
  const classes = responseClasses(surveyId);
  const questions = [];
  for (const q of survey.questions) {
    const item = { id: q.id, text: q.text, type: q.type };
    if (q.type === 'scale') {
      const max = q.scale_max || 5;
      const rows = db.prepare(`
        SELECT r.class_id AS cid, a.text_value AS v
        FROM answers a JOIN responses r ON r.id = a.response_id
        WHERE a.question_id = ? AND r.survey_id = ?
      `).all(q.id, surveyId);
      item.scale_max = max;
      item.counts = {};   // cid -> { "1": n, "2": n, ... }
      item.averages = {}; // cid -> средняя оценка
      const acc = {};
      for (const row of rows) {
        const v = Number(row.v);
        if (!Number.isInteger(v) || v < 1 || v > max) continue;
        if (!acc[row.cid]) acc[row.cid] = { sum: 0, n: 0, byValue: {} };
        acc[row.cid].sum += v;
        acc[row.cid].n += 1;
        acc[row.cid].byValue[v] = (acc[row.cid].byValue[v] || 0) + 1;
      }
      for (const [cidKey, a] of Object.entries(acc)) {
        const cid = Number(cidKey);
        item.counts[cid] = a.byValue;
        item.averages[cid] = Math.round((a.sum / a.n) * 10) / 10;
      }
      item.totals = {};
      for (const c of classes) item.totals[c.id] = (acc[c.id] || {}).n || 0;
      questions.push(item);
      continue;
    }
    if (q.type === 'text') {
      item.totals = {};
      const rows = db.prepare(`
        SELECT r.class_id AS cid, COUNT(*) AS c
        FROM answers a JOIN responses r ON r.id = a.response_id
        WHERE a.question_id = ? AND r.survey_id = ? AND a.text_value IS NOT NULL AND a.text_value != ''
        GROUP BY r.class_id
      `).all(q.id, surveyId);
      for (const row of rows) item.totals[row.cid] = row.c;
    } else {
      item.options = [];
      for (const o of q.options) {
        const counts = {};
        const rows = db.prepare(`
          SELECT r.class_id AS cid, COUNT(*) AS c
          FROM answers a JOIN responses r ON r.id = a.response_id
          WHERE a.question_id = ? AND a.option_id = ? AND r.survey_id = ?
          GROUP BY r.class_id
        `).all(q.id, o.id, surveyId);
        for (const row of rows) counts[row.cid] = row.c;
        item.options.push({ id: o.id, text: o.text, counts });
      }
      item.totals = {};
      const trows = db.prepare(`
        SELECT r.class_id AS cid, COUNT(DISTINCT a.response_id) AS c
        FROM answers a JOIN responses r ON r.id = a.response_id
        WHERE a.question_id = ? AND r.survey_id = ?
        GROUP BY r.class_id
      `).all(q.id, surveyId);
      for (const row of trows) item.totals[row.cid] = row.c;
    }
    questions.push(item);
  }
  return { survey, classes, questions };
}

/* ---------- участники (персональные данные — только администратору) ---------- */

function getParticipants(surveyId) {
  const participants = db.prepare(`
    SELECT r.id, r.first_name, r.last_name, r.created_at, cl.name AS class
    FROM responses r
    LEFT JOIN classes cl ON cl.id = r.class_id
    WHERE r.survey_id = ?
    ORDER BY cl.name ASC, r.last_name ASC, r.first_name ASC
  `).all(surveyId);
  const byClass = db.prepare(`
    SELECT cl.id, cl.name, COUNT(*) AS count
    FROM responses r JOIN classes cl ON cl.id = r.class_id
    WHERE r.survey_id = ?
    GROUP BY cl.id ORDER BY cl.name ASC
  `).all(surveyId);
  return { participants, by_class: byClass };
}

/* ---------- дашборд админки ---------- */

function getDashboard() {
  const surveys = listSurveys(true);
  let active = 0, scheduled = 0, closed = 0, responsesTotal = 0;
  for (const s of surveys) {
    responsesTotal += Number(s.responses_count || 0);
    const st = surveyState(s);
    if (st === 'open') active += 1;
    else if (st === 'scheduled') scheduled += 1;
    else if (st === 'closed') closed += 1;
  }
  const week = Number(db.prepare(
    "SELECT COUNT(*) AS c FROM responses WHERE created_at >= datetime('now', '-7 days')"
  ).get().c);
  // Активность за 14 дней (включая пустые дни), день — в поясе сервера.
  const rows = db.prepare(
    "SELECT created_at FROM responses WHERE created_at >= datetime('now', '-13 days')"
  ).all();
  const map = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    map.set(d.toLocaleDateString('sv-SE'), 0);
  }
  for (const row of rows) {
    const d = new Date(String(row.created_at).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString('sv-SE');
    if (map.has(key)) map.set(key, map.get(key) + 1);
  }
  const classesCount = Number(db.prepare('SELECT COUNT(*) AS c FROM classes').get().c);
  const top = surveys.slice(0, 6).map((s) => ({
    id: s.id, title: s.title, responses_count: Number(s.responses_count || 0), state: surveyState(s)
  }));
  return {
    total_surveys: surveys.length,
    active_surveys: active,
    scheduled_surveys: scheduled,
    closed_surveys: closed,
    responses_total: responsesTotal,
    responses_week: week,
    classes_count: classesCount,
    by_day: [...map.entries()].map(([date, count]) => ({ date, count })),
    top
  };
}

/* ---------- попытки входа (защита от перебора, хранится в БД) ---------- */

function loginAttemptsGet(ip) {
  const row = db.prepare('SELECT count, reset_at FROM login_attempts WHERE ip = ?').get(ip);
  return row || null;
}

function loginAttemptsFail(ip, windowMs) {
  const now = Date.now();
  const row = loginAttemptsGet(ip);
  if (!row || row.reset_at <= now) {
    db.prepare('INSERT INTO login_attempts(ip, count, reset_at) VALUES(?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = 1, reset_at = excluded.reset_at').run(ip, now + windowMs);
  } else {
    db.prepare('UPDATE login_attempts SET count = count + 1 WHERE ip = ?').run(ip);
  }
}

function loginAttemptsClear(ip) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
}

module.exports = {
  db,
  getSetting,
  setSetting,
  listClasses,
  createClass,
  createClasses,
  getClass,
  renameClass,
  deleteClass,
  listSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  setPublished,
  deleteSurvey,
  duplicateSurvey,
  findExistingResponse,
  countResponsesByIp,
  saveResponse,
  getSummary,
  getIndividualAnswers,
  getBreakdown,
  getParticipants,
  getDashboard,
  loginAttemptsGet,
  loginAttemptsFail,
  loginAttemptsClear,
  normalizeName,
  nameKey,
  optionText,
  normalizeDateTime,
  surveyState,
  getPublishHistory
};
