'use strict';
// Строгая проверка структуры PDF: заголовок, xref-таблица, смещения объектов.
const fs = require('node:fs');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin1 = buf.toString('latin1');

function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

if (buf.slice(0, 5).toString('latin1') !== '%PDF-') fail('нет заголовка %PDF-');

const startxrefPos = latin1.lastIndexOf('startxref');
if (startxrefPos === -1) fail('нет startxref');
const afterStartxref = latin1.slice(startxrefPos + 9).trim();
const xrefOffset = parseInt(afterStartxref.split(/\s+/)[0], 10);
if (!Number.isFinite(xrefOffset)) fail('startxref offset не число');

if (latin1.slice(xrefOffset, xrefOffset + 4) !== 'xref') fail('по смещению startxref не xref');

// парсим xref
const xrefBody = latin1.slice(xrefOffset + 4);
const headerMatch = /^\s*(\d+)\s+(\d+)\s*\n/.exec(xrefBody);
if (!headerMatch) fail('нет заголовка xref');
const startId = Number(headerMatch[1]);
const count = Number(headerMatch[2]);
let cursor = headerMatch.index + headerMatch[0].length;

const entries = [];
for (let i = 0; i < count; i++) {
  const entry = xrefBody.slice(cursor, cursor + 20);
  const m = /^(\d{10}) (\d{5}) ([nf])/.exec(entry);
  if (!m) fail(`плохая запись xref #${i}: "${entry.replace(/\n/g, '\\n')}"`);
  entries.push({ id: startId + i, offset: Number(m[1]), gen: Number(m[2]), type: m[3] });
  cursor += 20;
}

let ok = true;
for (const e of entries) {
  if (e.id === 0) continue;
  if (e.type !== 'n') { console.log(`  id ${e.id}: free/ignored`); continue; }
  const at = latin1.slice(e.offset, e.offset + 30);
  const expect = `${e.id} 0 obj`;
  if (!at.startsWith(expect)) { ok = false; console.error(`  id ${e.id}: offset ${e.offset} указывает на "${at.slice(0, 12).replace(/\n/g, '\\n')}" (ожидалось "${expect}")`); }
}

if (!ok) fail('есть неверные смещения объектов');
console.log(`OK: PDF корректен. Объектов: ${entries.length}, startxref=${xrefOffset}, размер=${buf.length}`);
