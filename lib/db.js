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
  type      TEXT NOT NULL CHECK(type IN ('single','multiple','text')),
  required  INTEGER NOT NULL DEFAULT 1
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

function listClasses() {
  return db.prepare('SELECT id, name, sort FROM classes ORDER BY sort ASC, name ASC').all();
}

function createClass(name) {
  const n = String(name).trim();
  if (!n) throw new Error('Название класса не может быть пустым');
  const info = db.prepare('INSERT INTO classes(name, sort) VALUES(?, ?)').run(n, 0);
  return getClass(Number(info.lastInsertRowid));
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
    'SELECT id, position, text, type, required FROM questions WHERE survey_id = ? ORDER BY position ASC, id ASC'
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
    const type = ['single', 'multiple', 'text'].includes(q.type) ? q.type : 'single';
    if (!text) continue;
    pos += 1;
    const info = db.prepare(
      'INSERT INTO questions(survey_id, position, text, type, required) VALUES(?,?,?,?,?)'
    ).run(surveyId, pos, text, type, q.required ? 1 : 0);
    const qid = Number(info.lastInsertRowid);
    if (type !== 'text') {
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

function findExistingResponse(surveyId, firstName, lastName, classId) {
  return db.prepare(
    'SELECT id, first_name, last_name, created_at FROM responses WHERE survey_id = ? AND name_key = ? AND class_id = ?'
  ).get(surveyId, nameKey(firstName, lastName), classId);
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
      'SELECT type FROM questions WHERE id = ? AND survey_id = ?'
    ).get(a.question_id, surveyId);
    if (!q) continue;
    if (q.type === 'text') {
      const tv = String(a.text || '').trim();
      if (!tv) continue;
      db.prepare(
        'INSERT INTO answers(response_id, question_id, text_value) VALUES(?,?,?)'
      ).run(responseId, a.question_id, tv);
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

function getSummary(surveyId) {
  const survey = getSurvey(surveyId);
  if (!survey) return null;
  const respCount = db.prepare(
    'SELECT COUNT(*) AS c FROM responses WHERE survey_id = ?'
  ).get(surveyId).c;

  const questions = [];
  for (const q of survey.questions) {
    const item = {
      id: q.id,
      text: q.text,
      type: q.type,
      required: !!q.required
    };
    if (q.type === 'text') {
      item.answers = db.prepare(`
        SELECT a.text_value AS text, r.first_name, r.last_name, cl.name AS class
        FROM answers a
        JOIN responses r ON r.id = a.response_id
        LEFT JOIN classes cl ON cl.id = r.class_id
        WHERE a.question_id = ? AND a.text_value IS NOT NULL AND a.text_value != ''
        ORDER BY r.id ASC
      `).all(q.id);
      item.total = item.answers.length;
    } else {
      item.total = db.prepare(`
        SELECT COUNT(DISTINCT a.response_id) AS c
        FROM answers a
        WHERE a.question_id = ?
      `).get(q.id).c;
      item.options = [];
      for (const o of q.options) {
        const count = db.prepare(`
          SELECT COUNT(*) AS c FROM answers a
          JOIN responses r ON r.id = a.response_id
          WHERE a.question_id = ? AND a.option_id = ? AND r.survey_id = ?
        `).get(q.id, o.id, surveyId).c;
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
  return { survey, responses_count: respCount, questions };
}

function getIndividualAnswers(surveyId) {
  const responses = db.prepare(`
    SELECT r.id, r.first_name, r.last_name, cl.name AS class, r.ip, r.created_at
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

module.exports = {
  db,
  getSetting,
  setSetting,
  listClasses,
  createClass,
  getClass,
  renameClass,
  deleteClass,
  listSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  setPublished,
  deleteSurvey,
  findExistingResponse,
  countResponsesByIp,
  saveResponse,
  getSummary,
  getIndividualAnswers,
  normalizeName,
  nameKey,
  optionText,
  normalizeDateTime,
  surveyState,
  getPublishHistory
};
