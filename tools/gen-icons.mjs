// 一次性脚本：生成 16/48/128 插件图标（QR 码风格图案）。
// 用法：node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const MODULES = 21; // 模拟 version 1 的模块数

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 固定种子的伪随机数据区 + 三个定位角 + 时序线，视觉上像一枚真二维码
function buildModuleGrid() {
  const grid = Array.from({ length: MODULES }, () => Array(MODULES).fill(false));
  const finder = (row, col) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[row + r][col + c] = edge || core;
      }
    }
  };

  let seed = 20261001;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 1;
  };

  for (let r = 0; r < MODULES; r += 1) {
    for (let c = 0; c < MODULES; c += 1) {
      grid[r][c] = nextRandom() === 1;
    }
  }

  finder(0, 0);
  finder(0, MODULES - 7);
  finder(MODULES - 7, 0);

  for (let i = 8; i < MODULES - 8; i += 1) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }
  grid[MODULES - 8][8] = true; // 对齐标记

  return grid;
}

function renderIcon(size) {
  const grid = buildModuleGrid();
  const total = MODULES + 2; // 四周各留 1 模块静区
  const moduleSize = size / total;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / moduleSize) - 1;
      const col = Math.floor(x / moduleSize) - 1;
      const dark = row >= 0 && row < MODULES && col >= 0 && col < MODULES && grid[row][col];
      const offset = (y * size + x) * 4;
      rgba[offset] = dark ? 30 : 255;
      rgba[offset + 1] = dark ? 41 : 255;
      rgba[offset + 2] = dark ? 59 : 255;
      rgba[offset + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), renderIcon(size));
  console.log(`icon${size}.png written`);
}
