// Generates VidFetch icons without any image library: renders RGBA pixels
// (2× supersampled for soft edges), encodes PNG via zlib, and writes
//   build/256x256.png, build/512x512.png   (electron-builder)
//   public/icon-192.png, public/icon-512.png (PWA manifest placeholders)
// A 256-size PNG is then converted to build/icon.ico by npm run icon.
// Design: rounded #6cb4ee square, dark download arrow into a tray — matches
// the app's flat dark-blue UI.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ── tiny PNG encoder (RGBA, 8-bit) ───────────────────────────────────
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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rows with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ── vector-ish rendering helpers (supersampled space) ────────────────
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}
function insideRoundedRect(px, py, cx, cy, hw, hh, r) {
  return roundedRectSDF(px, py, cx, cy, hw, hh, r) <= 0;
}
function insideSegment(px, py, x1, y1, x2, y2, halfWidth) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  const dx = wx - t * vx, dy = wy - t * vy;
  return dx * dx + dy * dy <= halfWidth * halfWidth;
}
function insideTriangle(px, py, ax, ay, bx, by, cx2, cy2) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx2 - bx) * (py - by) - (cy2 - by) * (px - bx);
  const s3 = (ax - cx2) * (py - cy2) - (ay - cy2) * (px - cx2);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// ── icon: 1024 logical space, sampled at any size ────────────────────
const BG = [108, 180, 238]; // #6cb4ee
const FG = [13, 15, 18]; // #0d0f12
function sample(u, v) {
  // u,v in 0..1024
  if (!insideRoundedRect(u, v, 512, 512, 512 - 2, 512 - 2, 220)) return [0, 0, 0, 0];
  // arrow shaft
  const shaft = insideRoundedRect(u, v, 512, 330, 62, 210, 56);
  // chevron head (triangle) + rounded tips
  const head =
    insideTriangle(u, v, 250, 480, 774, 480, 512, 760) ||
    insideSegment(u, v, 250, 480, 512, 760, 56) ||
    insideSegment(u, v, 774, 480, 512, 760, 56);
  // tray
  const tray = insideRoundedRect(u, v, 512, 866, 300, 42, 42);
  const fg = shaft || head || tray;
  if (!fg) return [BG[0], BG[1], BG[2], 255];
  return [FG[0], FG[1], FG[2], 255];
}
function render(size) {
  const SS = 2; // 2× supersample
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x * SS + sx + 0.5) / (size * SS)) * 1024;
          const v = ((y * SS + sy + 0.5) / (size * SS)) * 1024;
          const p = sample(u, v);
          r += p[0]; g += p[1]; b += p[2]; a += p[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, rgba);
}

const out = (p, buf) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log("wrote", p, buf.length, "bytes");
};
out("build/256x256.png", render(256));
out("build/512x512.png", render(512));
out("public/icon-192.png", render(192));
out("public/icon-512.png", render(512));
