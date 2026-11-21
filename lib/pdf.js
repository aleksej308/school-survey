'use strict';

/**
 * Минимальный генератор PDF с поддержкой кириллицы (встраиваемый TrueType-шрифт).
 * Без внешних зависимостей. buildPdf(content, fontPath) -> Buffer.
 *
 * content = {
 *   title: string,
 *   subtitle: string[],
 *   sections: [{ heading?: string, lines: string[] }]
 * }
 */

const fs = require('node:fs');

/* ---------- чтение TTF ---------- */
function u16(b, o) { return b.readUInt16BE(o); }
function i16(b, o) { return b.readInt16BE(o); }
function u32(b, o) { return b.readUInt32BE(o); }

function makeCmap4(buf, off) {
  const segCountX2 = u16(buf, off + 6);
  const segCount = segCountX2 / 2;
  const endCodeOff = off + 14;
  const startCodeOff = endCodeOff + segCount * 2 + 2; // +2 байта reservedPad
  const idDeltaOff = startCodeOff + segCount * 2;
  const idRangeOffsetOff = idDeltaOff + segCount * 2;

  return function glyph(c) {
    if (c > 0xFFFF) return 0;
    for (let i = 0; i < segCount; i++) {
      const start = u16(buf, startCodeOff + i * 2);
      const end = u16(buf, endCodeOff + i * 2);
      if (c < start || c > end) continue;
      const idDelta = i16(buf, idDeltaOff + i * 2);
      const idRangeOffset = u16(buf, idRangeOffsetOff + i * 2);
      if (idRangeOffset === 0) {
        return (c + idDelta) & 0xFFFF;
      }
      const addr = idRangeOffsetOff + i * 2 + idRangeOffset + (c - start) * 2;
      const g = u16(buf, addr);
      if (g === 0) return 0;
      return (g + idDelta) & 0xFFFF;
    }
    return 0;
  };
}

function makeCmap12(buf, off) {
  const nGroups = u32(buf, off + 12);
  const groupsOff = off + 16;
  return function glyph(c) {
    for (let i = 0; i < nGroups; i++) {
      const gOff = groupsOff + i * 12;
      const start = u32(buf, gOff);
      const end = u32(buf, gOff + 4);
      const startGid = u32(buf, gOff + 8);
      if (c >= start && c <= end) return (startGid + (c - start)) >>> 0;
    }
    return 0;
  };
}

function parseFont(buf) {
  const numTables = u16(buf, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    tables[buf.toString('ascii', off, off + 4)] = { offset: u32(buf, off + 8), length: u32(buf, off + 12) };
  }
  for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'cmap']) {
    if (!tables[t]) throw new Error('TTF: отсутствует таблица ' + t);
  }

  const unitsPerEm = u16(buf, tables.head.offset + 18);
  const bbox = [
    i16(buf, tables.head.offset + 36),
    i16(buf, tables.head.offset + 38),
    i16(buf, tables.head.offset + 40),
    i16(buf, tables.head.offset + 42)
  ];
  const ascent = i16(buf, tables.hhea.offset + 4);
  const descent = i16(buf, tables.hhea.offset + 6);
  const numberOfHMetrics = u16(buf, tables.hhea.offset + 34);
  const numGlyphs = u16(buf, tables.maxp.offset + 4);
  const hmtx = tables.hmtx.offset;

  const widths = new Array(numGlyphs);
  let lastAdv = 0;
  for (let g = 0; g < numGlyphs; g++) {
    let adv = lastAdv;
    if (g < numberOfHMetrics) adv = u16(buf, hmtx + g * 4);
    widths[g] = adv;
    lastAdv = adv;
  }

  // cmap
  const cmapOff = tables.cmap.offset;
  const nCmaps = u16(buf, cmapOff + 2);
  let best = null;
  for (let i = 0; i < nCmaps; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = u16(buf, rec);
    const encoding = u16(buf, rec + 2);
    const subOff = cmapOff + u32(buf, rec + 4);
    const format = u16(buf, subOff);
    let score = -1;
    if (platform === 3 && encoding === 1 && format === 4) score = 100;
    else if (platform === 3 && encoding === 10 && format === 12) score = 90;
    else if (platform === 0 && format === 4) score = 80;
    else if (platform === 0 && format === 12) score = 70;
    if (score > (best ? best.score : -1)) best = { subOff, format, score };
  }
  let glyphFor = () => 0;
  if (best) glyphFor = best.format === 12 ? makeCmap12(buf, best.subOff) : makeCmap4(buf, best.subOff);

  const scale = 1000 / unitsPerEm;
  return {
    buffer: buf,
    unitsPerEm,
    numGlyphs,
    bboxPdf: bbox.map((v) => Math.round(v * scale)),
    ascentPdf: Math.round(ascent * scale),
    descentPdf: Math.round(descent * scale),
    widthsPdf: widths.map((w) => Math.round(w * scale)),
    glyphFor
  };
}

const fontCache = new Map();
function loadFont(fontPath) {
  if (fontCache.has(fontPath)) return fontCache.get(fontPath);
  const buf = fs.readFileSync(fontPath);
  const font = parseFont(buf);
  fontCache.set(fontPath, font);
  return font;
}

/* ---------- текст ---------- */
function textWidth(font, text, size) {
  let total = 0;
  for (const ch of text) {
    const g = font.glyphFor(ch.codePointAt(0)) || 0;
    total += font.widthsPdf[g] || 0;
  }
  return (total * size) / 1000;
}

function encodeText(font, text, glyphMap) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const g = font.glyphFor(cp) || 0;
    if (glyphMap && cp > 0 && cp <= 0xFFFF) glyphMap.set(g, cp);
    out += g.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

function wrap(font, text, maxW, size) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (raw === '') { out.push(''); continue; }
    const words = raw.split(' ');
    let line = '';
    for (const w of words) {
      const candidate = line ? line + ' ' + w : w;
      if (line && textWidth(font, candidate, size) > maxW) {
        out.push(line);
        line = w;
      } else {
        line = candidate;
      }
      // длинное слово без пробелов — режем посимвольно
      if (!line.includes(' ') && textWidth(font, line, size) > maxW) {
        let cur = '';
        for (const ch of line) {
          if (textWidth(font, cur + ch, size) > maxW) { out.push(cur); cur = ch; }
          else cur += ch;
        }
        line = cur;
      }
    }
    if (line !== '') out.push(line);
  }
  return out;
}

/* ---------- вёрстка страниц ---------- */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const BOTTOM = 60;

function render(font, content) {
  const pages = [];
  let ops = [];
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - MARGIN * 2;
  const glyphMap = new Map();

  function ensureSpace(h) {
    if (y - h < BOTTOM) {
      pages.push(ops);
      ops = [];
      y = PAGE_H - MARGIN;
    }
  }

  function drawLine(text, size, gapBefore, gapAfter, indent, color) {
    const lines = wrap(font, text, maxW - indent, size);
    if (lines.length === 0) lines.push('');
    let first = true;
    for (const ln of lines) {
      if (first && gapBefore > 0) { ensureSpace(gapBefore); y -= gapBefore; }
      ensureSpace(size * 1.35);
      if (color) ops.push(`${color} rg`);
      ops.push(`BT /F1 ${size} Tf ${MARGIN + indent} ${y.toFixed(2)} Td <${encodeText(font, ln, glyphMap)}> Tj ET`);
      if (color) ops.push('0 0 0 rg');
      y -= size * 1.35;
      first = false;
    }
    if (gapAfter > 0) y -= gapAfter;
  }

  drawLine(content.title || '', 18, 0, 14, 0, '0.15 0.15 0.15');
  for (const s of content.subtitle || []) drawLine(s, 10, 0, 2, 0, '0.4 0.4 0.4');
  for (const sec of content.sections || []) {
    if (sec.heading) drawLine(sec.heading, 12.5, 16, 5, 0, '0.1 0.15 0.35');
    for (const ln of sec.lines || []) drawLine(ln, 11, 2, 1, 12, null);
  }
  pages.push(ops);

  return { pages, glyphMap };
}

function buildToUnicode(glyphMap) {
  const entries = [];
  for (const [g, cp] of glyphMap) {
    entries.push(`<${g.toString(16).toUpperCase().padStart(4, '0')}> <${cp.toString(16).toUpperCase().padStart(4, '0')}>`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${entries.length} beginbfchar
${entries.join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/* ---------- сборка PDF ---------- */
function buildPdf(content, fontPath) {
  const font = loadFont(fontPath);
  const { pages, glyphMap } = render(font, content);

  const parts = [];
  let byteOffset = 0;
  const offsets = new Map();
  function emit(buf) { parts.push(buf); byteOffset += buf.length; }
  function obj(id, bodyStr) {
    offsets.set(id, byteOffset);
    emit(Buffer.from(`${id} 0 obj\n${bodyStr}\nendobj\n`, 'utf8'));
  }
  function streamObj(id, head, data) {
    offsets.set(id, byteOffset);
    const h = Buffer.from(`${id} 0 obj\n${head}\nstream\n`, 'utf8');
    const e = Buffer.from('\nendstream\nendobj\n', 'utf8');
    emit(h); emit(data); emit(e);
  }

  // Обязательный заголовок PDF (записываем до всех объектов).
  emit(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));

  const widthList = font.widthsPdf.join(' ');

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${8 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  // FontFile2 (шрифт целиком)
  streamObj(3, `<< /Length ${font.buffer.length} /Length1 ${font.buffer.length} >>`, font.buffer);

  const [x0, y0, x1, y1] = font.bboxPdf;
  obj(4, `<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 4 /FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 /Ascent ${font.ascentPdf} /Descent ${font.descentPdf} /CapHeight ${font.ascentPdf} /StemV 80 /FontFile2 3 0 R >>`);

  obj(5, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 4 0 R /DW 1000 /W [0 [${widthList}]] >>`);

  obj(6, '<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>');

  const toUni = Buffer.from(buildToUnicode(glyphMap), 'utf8');
  streamObj(7, `<< /Length ${toUni.length} >>`, toUni);

  pages.forEach((ops, i) => {
    const content = Buffer.from(ops.join('\n'), 'utf8');
    const pageId = 8 + i * 2;
    const contentId = 9 + i * 2;
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 6 0 R >> >> /Contents ${contentId} 0 R >>`);
    streamObj(contentId, `<< /Length ${content.length} >>`, content);
  });

  const maxId = 8 + (pages.length - 1) * 2 + 1;
  const xrefOffset = byteOffset;

  let xrefStr = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    const off = offsets.get(id);
    xrefStr += (off === undefined ? '0000000000' : String(off).padStart(10, '0')) + ' 00000 n \n';
  }

  emit(Buffer.from(xrefStr, 'utf8'));
  emit(Buffer.from(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'utf8'));

  return Buffer.concat(parts);
}

module.exports = { buildPdf, loadFont, textWidth };
