// Generuje ikony aplikacji i zasobnika bez zależności (własny enkoder PNG + ICO).
// Uruchom: npm run icons
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BLUE = [0x2f, 0x52, 0xd6];
const WHITE = [255, 255, 255];
const RED = [0xe5, 0x2b, 0x2b];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- geometria w układzie 0..1 ---
function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inN(x, y, bold) {
  const top = 0.25;
  const bottom = 0.75;
  const left = bold ? 0.22 : 0.27;
  const right = 1 - left;
  const w = bold ? 0.16 : 0.125;
  if (y < top || y > bottom) return false;
  if (x >= left && x <= left + w) return true;
  if (x >= right - w && x <= right) return true;
  const t = (y - top) / (bottom - top);
  const dx = left + t * (right - w - left);
  return x >= dx && x <= dx + w;
}

/** Zwraca [r,g,b,a] dla punktu. */
function sample(x, y, opts) {
  if (opts.rec) {
    const d = Math.hypot(x - 0.73, y - 0.73);
    if (d <= 0.25) return [...RED, 255];
    if (d <= 0.32) return [...WHITE, 255];
  }
  if (!inRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  if (inN(x, y, opts.bold)) return [...WHITE, 255];
  return [...BLUE, 255];
}

function render(size, opts = {}) {
  const ss = size >= 256 ? 3 : 6;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return encodePng(size, out);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(__dirname, 'icon.png'), render(1024));
fs.writeFileSync(
  path.join(__dirname, 'icon.ico'),
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: render(size, { bold: size <= 32 }) }))),
);
fs.writeFileSync(path.join(assets, 'icon.png'), render(256));
fs.writeFileSync(path.join(assets, 'tray.png'), render(16, { bold: true }));
fs.writeFileSync(path.join(assets, 'tray@2x.png'), render(32, { bold: true }));
fs.writeFileSync(path.join(assets, 'tray-rec.png'), render(16, { bold: true, rec: true }));
fs.writeFileSync(path.join(assets, 'tray-rec@2x.png'), render(32, { bold: true, rec: true }));
console.log('Ikony zapisane w build/ i assets/.');
