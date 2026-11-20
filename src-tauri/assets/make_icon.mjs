// Renders the RocketSizer icon (icon.ico + icon.png) with a supersampled shape rasterizer.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));

function inRoundedSquare(u, v, radius) {
  const x = Math.abs(u - 0.5) - (0.5 - radius);
  const y = Math.abs(v - 0.5) - (0.5 - radius);
  const ox = Math.max(x, 0);
  const oy = Math.max(y, 0);
  return Math.hypot(ox, oy) <= radius && Math.max(x, y) <= radius;
}

function toRocket(u, v) {
  const ang = (42 * Math.PI) / 180;
  const dx = u - 0.5;
  const dy = 0.5 - v;
  return [dx * Math.cos(ang) - dy * Math.sin(ang), dx * Math.sin(ang) + dy * Math.cos(ang)];
}

function shade(u, v) {
  if (!inRoundedSquare(u, v, 0.22)) return [0, 0, 0, 0];
  const bgTop = hex("#0b2a52");
  const bgBot = hex("#050b1d");
  let col = mix(bgBot, bgTop, 1.15 - v * 1.2 + (u - 0.5) * 0.25);
  const glow = Math.exp(-(Math.hypot(u - 0.62, v - 0.36) ** 2) / 0.05);
  col = mix(col, hex("#0ea5e9"), glow * 0.55);
  const ringEdge = Math.hypot(u - 0.05, v - 0.99);
  col = mix(col, hex("#1e3a8a"), Math.max(0, 0.35 - Math.abs(ringEdge - 0.55) * 4));

  const ringAng = (-28 * Math.PI) / 180;
  const rx = (u - 0.5) * Math.cos(ringAng) - (0.5 - v) * Math.sin(ringAng);
  const ry = (u - 0.5) * Math.sin(ringAng) + (0.5 - v) * Math.cos(ringAng);
  const ringD = Math.abs(Math.hypot(rx / 0.44, ry / 0.16) - 1) * 0.16;
  const [lx, ly] = toRocket(u, v);
  const behindRocket = ry > 0;
  if (ringD < 0.017 && (behindRocket || Math.abs(lx) > 0.14 || ly > 0.4 || ly < -0.42)) {
    col = mix(col, hex("#7dd3fc"), 0.95);
  }

  // Flame (below tail).
  const fy = -0.2 - ly;
  if (fy > 0 && fy < 0.24) {
    const half = 0.075 * (1 - fy / 0.24) ** 0.8;
    if (Math.abs(lx) < half) {
      const core = Math.abs(lx) < half * 0.45;
      col = core ? mix(hex("#fde047"), hex("#fffbeb"), 1 - fy / 0.24) : mix(hex("#fb923c"), hex("#ef4444"), fy / 0.24);
    }
  }
  // Fins.
  const ft = (Math.abs(lx) - 0.085) / 0.115;
  if (ft >= 0 && ft <= 1 && ly <= -0.06 - ft * 0.24 && ly >= -0.2 - ft * 0.1) {
    col = mix(hex("#ef4444"), hex("#b91c1c"), lx > 0 ? 0.6 : 0);
  }
  // Body + nose.
  const bodyHalf = 0.092;
  let inBody = false;
  if (ly >= -0.2 && ly <= 0.1) inBody = Math.abs(lx) <= bodyHalf;
  else if (ly > 0.1 && ly <= 0.38) inBody = Math.abs(lx) <= bodyHalf * Math.sqrt(Math.max(0, 1 - ((ly - 0.1) / 0.28) ** 2));
  if (inBody) {
    const shadeT = (lx + bodyHalf) / (2 * bodyHalf);
    col = mix(hex("#f8fafc"), hex("#94a3b8"), shadeT * shadeT * 0.9);
    if (ly > 0.2) col = mix(hex("#38bdf8"), hex("#0369a1"), shadeT * 0.8);
    if (ly > -0.12 && ly < -0.07) col = mix(hex("#0ea5e9"), hex("#0369a1"), shadeT);
    if (Math.hypot(lx, ly - 0.075) < 0.048) col = mix(hex("#0b2a52"), hex("#7dd3fc"), 0.35 + (lx < 0 ? 0.25 : 0));
    if (Math.hypot(lx, ly - 0.075) < 0.048 && Math.hypot(lx + 0.015, ly - 0.09) < 0.014) col = hex("#e0f2fe");
  }
  // Engine bell.
  if (ly < -0.2 && ly > -0.245 && Math.abs(lx) < 0.055) col = hex("#475569");
  return [...col, 1];
}

function render(size) {
  const ss = size <= 32 ? 6 : 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const [cr, cg, cb, ca] = shade((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const o = (j * size + i) * 4;
      const n = ss * ss;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngs = SIZES.map((s) => encodePng(s, render(s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);
let offset = 6 + 16 * SIZES.length;
const entries = SIZES.map((s, idx) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[idx].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[idx].length;
  return e;
});
writeFileSync(join(OUT_DIR, "icon.ico"), Buffer.concat([header, ...entries, ...pngs]));
writeFileSync(join(OUT_DIR, "icon.png"), pngs[SIZES.indexOf(256)]);
console.log("icon.ico and icon.png written");
