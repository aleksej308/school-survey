'use strict';

/**
 * Компактный генератор QR-кодов без внешних зависимостей.
 *
 * Поддержка: байтовый режим, уровень коррекции L, версии 1–5
 * (до 108 байт данных — достаточно для любых ссылок на опросы).
 *
 * makeQrMatrix(text) -> массив строк: matrix[y][x] === true — тёмный модуль.
 * Бросает исключение, если текст длиннее 108 байт.
 */
(function (global) {

  // Ёмкость данных (в байтовых кодах) и число кодов коррекции Рида—Соломона
  // для уровня L, версии 1–5. Все эти версии — один блок, интерливинг не нужен.
  const DATA_CODEWORDS = [19, 34, 55, 80, 108];
  const EC_CODEWORDS = [7, 10, 15, 20, 26];
  const ALIGN_POS = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };

  /* ---------- арифметика GF(256), порождающий многочлен 0x11D ---------- */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  }

  /* Порождающий многочлен Рида—Соломона степени deg:
     (x + α^0)(x + α^1)…(x + α^(deg-1)). Коэффициенты по возрастанию степени. */
  function rsGenerator(deg) {
    let poly = [1];
    let root = 1;
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j + 1] ^= poly[j];              // умножение на x
        next[j] ^= gmul(poly[j], root);      // умножение на α^i
      }
      poly = next;
      root = gmul(root, 2);
    }
    return poly;
  }

  /* Остаток от деления сообщения на порождающий многочлен (синтетическое деление). */
  function rsRemainder(data, deg) {
    const genDesc = rsGenerator(deg).slice().reverse(); // по убыванию степени, genDesc[0] = 1
    const res = new Array(deg).fill(0);
    for (const b of data) {
      const factor = b ^ res.shift();
      res.push(0);
      if (factor !== 0) {
        for (let i = 0; i < deg; i++) res[i] ^= gmul(genDesc[i + 1], factor);
      }
    }
    return res;
  }

  /* ---------- кодирование битового потока ---------- */

  function encodeData(bytes, version) {
    const capBits = DATA_CODEWORDS[version - 1] * 8;
    const bits = [];
    const push = (val, n) => {
      for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    push(0b0100, 4);            // байтовый режим
    push(bytes.length, 8);      // длина (для версий 1–9 — 8 бит)
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, capBits - bits.length)); // терминатор
    while (bits.length % 8 !== 0) bits.push(0);  // до границы байта
    const pad = [0xEC, 0x11];
    let pi = 0;
    while (bits.length < capBits) { push(pad[pi % 2], 8); pi += 1; }
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      out.push(v);
    }
    return out;
  }

  /* ---------- построение матрицы ---------- */

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  function buildBase(version) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

    // Поисковые узоры (3 угла) с разделителями
    const finder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
            (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
              (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
          set(x, y, dark);
        }
      }
    };
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    // Выравнивающие узоры (версии 2+), кроме совпадающих с поисковыми
    const align = ALIGN_POS[version] || [];
    for (const ay of align) {
      for (const ax of align) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // Направляющие линии
    for (let i = 8; i < size - 8; i++) {
      if (!isFn[6][i]) set(i, 6, i % 2 === 0);
      if (!isFn[i][6]) set(6, i, i % 2 === 0);
    }

    // Тёмный модуль и резерв под формат-информацию
    set(8, size - 8, true);
    for (let i = 0; i <= 8; i++) {
      if (!isFn[8][i]) set(i, 8, false);
      if (!isFn[i][8]) set(8, i, false);
    }
    for (let i = 0; i < 8; i++) {
      if (!isFn[size - 1 - i][8]) set(8, size - 1 - i, false);
      if (!isFn[8][size - 1 - i]) set(size - 1 - i, 8, false);
    }
    return { size, modules, isFn };
  }

  function placeData(size, isFn, modules, codewords) {
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    const bitAt = (k) => ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // столбец направляющей линии
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let dx = 0; dx < 2; dx++) {
          const x = right - dx;
          if (!isFn[y][x]) {
            modules[y][x] = bitIdx < totalBits ? bitAt(bitIdx) : false;
            bitIdx += 1;
          }
        }
      }
      upward = !upward;
    }
  }

  function formatBits(mask) {
    const data = (1 << 3) | mask; // уровень L = 01
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
  }

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  function drawFormat(size, modules, mask) {
    const bits = formatBits(mask);
    const set = (x, y, dark) => { modules[y][x] = dark; };
    for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
    set(8, 7, getBit(bits, 6));
    set(8, 8, getBit(bits, 7));
    set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
    set(8, size - 8, true); // всегда тёмный
  }

  function penalty(size, m) {
    let score = 0;
    // Правило 1: серии 5+ одинаковых модулей в строках и столбцах
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x < size; x++) {
        if (m[y][x] === m[y][x - 1]) { run += 1; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let x = 0; x < size; x++) {
      let run = 1;
      for (let y = 1; y < size; y++) {
        if (m[y][x] === m[y - 1][x]) { run += 1; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // Правило 2: блоки 2×2 одного цвета
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    // Правило 3: похожие на поисковые узоры последовательности
    const PAT1 = '00001011101';
    const PAT2 = '10111010000';
    const rows = [];
    for (let y = 0; y < size; y++) rows.push(m[y].map((v) => (v ? '1' : '0')).join(''));
    for (let x = 0; x < size; x++) rows.push(m.map((r) => (r[x] ? '1' : '0')).join(''));
    for (const s of rows) {
      for (let i = 0; i + 11 <= s.length; i++) {
        const sub = s.slice(i, i + 11);
        if (sub === PAT1 || sub === PAT2) score += 40;
      }
    }
    // Правило 4: доля тёмных модулей
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark += 1;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += k * 10;
    return score;
  }

  function makeQrMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let version = 0;
    for (let v = 1; v <= DATA_CODEWORDS.length; v++) {
      if (bytes.length + 2 <= DATA_CODEWORDS[v - 1]) { version = v; break; }
    }
    if (!version) throw new Error('QR: текст длиннее 108 байт');
    const data = encodeData(bytes, version);
    const ec = rsRemainder(data, EC_CODEWORDS[version - 1]);
    const codewords = data.concat(ec);

    const { size, modules: baseModules, isFn } = buildBase(version);
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const modules = baseModules.map((row) => row.slice());
      placeData(size, isFn, modules, codewords);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!isFn[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
        }
      }
      drawFormat(size, modules, mask);
      const sc = penalty(size, modules);
      if (sc < bestScore) { bestScore = sc; best = modules; }
    }
    return best;
  }

  global.makeQrMatrix = makeQrMatrix;
})(typeof window !== 'undefined' ? window : (typeof module !== 'undefined' && module.exports ? module.exports : globalThis));
