/* 生成 PWA 图标（PNG，零依赖：手写 PNG 编码）。
 * 设计：深色圆角底 + 红涨绿跌的双柱（呼应 A 股口径）。
 * 用法：node _tests/gen-pwa-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = 'D:/mywork/stock-alert-console';

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
/* 圆角矩形覆盖测试（抗锯齿用超采样） */
function makeIcon(size, pad) {
  const S = 4; // 超采样倍数
  const W = size * S;
  const px = Buffer.alloc(W * W * 4);
  const r = W * 0.22;                      // 圆角半径
  const bg = [0x1b, 0x1f, 0x27];           // 深底
  const red = [0xd9, 0x3a, 0x3a];          // 涨
  const green = [0x1a, 0x8f, 0x5a];        // 跌
  const inset = W * (pad || 0.16);         // 柱状图区留白

  function insideRound(x, y) {
    // 圆角矩形
    const cx = Math.min(Math.max(x, r), W - r), cy = Math.min(Math.max(y, r), W - r);
    const dx = x - cx, dy = y - cy;
    return (dx * dx + dy * dy) <= r * r;
  }
  function bar(x, y, x0, x1, y0, y1) { return x >= x0 && x < x1 && y >= y0 && y < y1; }

  const inner = W - inset * 2;
  const bw = inner * 0.26;                       // 柱宽
  const gap = inner * 0.14;
  const x0 = inset, x1 = inset + bw;
  const x2 = inset + bw + gap, x3 = inset + bw + gap + bw;
  const base = W - inset * 1.35;
  const h1 = inner * 0.52, h2 = inner * 0.78;    // 左矮（跌）右高（涨）

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = null;
      if (insideRound(x + 0.5, y + 0.5)) {
        c = bg;
        const yy = y + 0.5, xx = x + 0.5;
        if (bar(xx, yy, x0, x1, base - h1, base)) c = green;
        if (bar(xx, yy, x2, x3, base - h2, base)) c = red;
        // 底部基准线
        if (yy >= base && yy < base + W * 0.022 && xx >= x0 && xx < x3) c = [0x5a, 0x62, 0x70];
      }
      if (c) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
    }
  }
  // 下采样（盒式平均，带 alpha 加权）
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r2 = 0, g2 = 0, b2 = 0, a2 = 0;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const j = ((y * S + dy) * W + (x * S + dx)) * 4;
        const a = px[j + 3] / 255;
        r2 += px[j] * a; g2 += px[j + 1] * a; b2 += px[j + 2] * a; a2 += a;
      }
      const n = S * S, k = (y * size + x) * 4;
      if (a2 > 0) { out[k] = Math.round(r2 / a2); out[k + 1] = Math.round(g2 / a2); out[k + 2] = Math.round(b2 / a2); }
      out[k + 3] = Math.round(255 * a2 / n);
    }
  }
  return png(size, size, out);
}

[[192, 0.16], [512, 0.16], [180, 0.22]].forEach(function (spec) {
  const size = spec[0];
  const name = size === 180 ? 'apple-touch-icon.png' : ('icon-' + size + '.png');
  fs.writeFileSync(path.join(OUT, name), makeIcon(size, spec[1]));
  console.log('wrote', name, fs.statSync(path.join(OUT, name)).size, 'bytes');
});
