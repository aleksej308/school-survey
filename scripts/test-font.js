'use strict';
// Проверка разбора cmap и ширин для кириллицы и латиницы.
const path = require('node:path');
const { loadFont, textWidth } = require('../lib/pdf');

const font = loadFont(path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf'));
console.log('unitsPerEm:', font.unitsPerEm, 'numGlyphs:', font.numGlyphs);
console.log('bbox:', font.bboxPdf, 'ascent:', font.ascentPdf, 'descent:', font.descentPdf);

const samples = ['А', 'Б', 'Я', 'а', 'я', 'ё', 'Ё', 'П', 'ж', 'A', 'z', '0', ' ', '—', '•'];
let ok = true;
for (const ch of samples) {
  const g = font.glyphFor(ch.codePointAt(0));
  const w = font.widthsPdf[g];
  if (!g || !w) { ok = false; console.log(`  FAIL: "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase()}) -> glyph=${g}, width=${w}`); }
  else console.log(`  "${ch}" -> glyph=${g}, width=${w}`);
}

const t = 'Привет, школа!';
console.log('textWidth("' + t + '", 11) =', textWidth(font, t, 11).toFixed(2));
console.log(ok ? 'FONT-OK' : 'FONT-FAIL');
