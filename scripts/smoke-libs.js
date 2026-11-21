'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildXlsx } = require('../lib/xlsx');
const { buildPdf } = require('../lib/pdf');

const outDir = path.join(__dirname, '..', 'data', 'smoke');
fs.mkdirSync(outDir, { recursive: true });

// --- XLSX ---
const xlsxBuf = buildXlsx([
  {
    name: 'Сводка',
    rows: [
      [{ v: 'Вопрос', bold: true }, { v: 'Вариант', bold: true }, { v: 'Кол-во', bold: true }, { v: 'Доля (%)', bold: true }],
      ['Любимый предмет', 'Математика', 10, 50],
      ['', 'Литература', 8, 40],
      [{ v: 'Свободный ответ', bold: true }, 'Всё нравится', 2, 10]
    ]
  },
  { name: 'Ответы', rows: [['№', 'Имя'], [1, 'Иван'], [2, 'Мария']] }
]);
const xlsxPath = path.join(outDir, 'test.xlsx');
fs.writeFileSync(xlsxPath, xlsxBuf);
console.log('XLSX magic:', xlsxBuf.slice(0, 2).toString('ascii'), 'size', xlsxBuf.length);

// --- PDF ---
const pdfBuf = buildPdf({
  title: 'Отчёт по опросу: Тестовый опрос',
  subtitle: ['Всего ответов: 12', 'Сформирован: 01.02.2025'],
  sections: [
    { heading: '1. Ваш любимый предмет? (один вариант)', lines: ['• Математика — 10 (50%)', '• Литература — 8 (40%)', '• История — 2 (10%)'] },
    { heading: '2. Что улучшить? (свободный ответ)', lines: ['• Побольше перемен (Иван Иванов, 9А)', '• Вкуснее еда в столовой (Мария Петрова, 10Б)'] }
  ]
}, path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf'));
const pdfPath = path.join(outDir, 'test.pdf');
fs.writeFileSync(pdfPath, pdfBuf);
console.log('PDF magic:', pdfBuf.slice(0, 5).toString('ascii'), 'size', pdfBuf.length);
const pdfText = pdfBuf.toString('latin1');
console.log('PDF has EOF:', pdfText.endsWith('%%EOF'));
console.log('PDF has DejaVuSans:', pdfText.includes('DejaVuSans'));
console.log('PDF has FontFile2:', pdfText.includes('FontFile2'));
console.log('Outputs:', xlsxPath, pdfPath);
