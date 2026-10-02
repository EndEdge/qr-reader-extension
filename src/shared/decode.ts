import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';

export type DecodeStatus = 'analyzing' | 'deep-scan';

const ENGINE_ELEMENT_ID = '__qr-reader-ext-engine';
// 一张图里二维码数量上限，同时作为迭代遮盖的次数保险丝
const MAX_CODES_PER_IMAGE = 16;

let engine: Html5Qrcode | null = null;

function getEngine(): Html5Qrcode {
  if (!engine) {
    let element = document.getElementById(ENGINE_ELEMENT_ID);
    if (!element) {
      element = document.createElement('div');
      element.id = ENGINE_ELEMENT_ID;
      element.style.display = 'none';
      document.body.appendChild(element);
    }
    engine = new Html5Qrcode(ENGINE_ELEMENT_ID);
  }
  return engine;
}

// 返回图中全部二维码内容（按识别顺序，已按内容去重）。多码识别三层策略：
// 1. 全图迭代扫描：jsQR 识别一个码后按坐标遮盖该区域继续扫，直到无新结果
//    （jsQR 挑选定位角是贪心的，多码时可能跨码组合失败，所以还需要第 2 层）；
// 2. 定位角分区域解码：按 1:1:3:1:1 黑白比例特征检测各二维码的定位角，框出
//    每个码的区域，逐区域裁剪成"单码图"隔离解码；
// 3. ZXing 引擎补充：其单结果按内容去重合并；仍为零则进入深度识别策略。
export async function decodeQrBlob(
  blob: Blob,
  onStatus: (status: DecodeStatus) => void,
): Promise<string[]> {
  onStatus('analyzing');

  const image = await loadImage(blob);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth || image.width;
  sourceCanvas.height = image.naturalHeight || image.height;

  const sourceContext = get2dContext(sourceCanvas);
  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const originalData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const results = collectCodes(new Uint8ClampedArray(originalData.data), width, height);
  mergeUnique(results, scanByRegions(sourceContext, originalData, width, height, results.length));

  // ZXing 引擎补充：jsQR 漏掉的码可能被它识别出来（单码场景也是主力引擎之一）
  mergeUnique(results, await scanWithZxing(blob));

  if (results.length === 0) {
    mergeUnique(results, await deepScan(image, originalData, width, height, onStatus));
  }

  if (results.length === 0) {
    throw new Error('No QR code found in the image.');
  }

  return results;
}

interface QrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function scanByRegions(
  context: CanvasRenderingContext2D,
  originalData: ImageData,
  width: number,
  height: number,
  priorCount: number,
): string[] {
  const regions = detectQrRegions(originalData.data, width, height);

  // 只检测到一个几乎覆盖全图的区域且全图扫描已有结果时，无需重复解码
  if (
    regions.length === 1 &&
    priorCount > 0 &&
    regions[0].width * regions[0].height > width * height * 0.8
  ) {
    return [];
  }

  const results: string[] = [];
  for (const region of regions.slice(0, MAX_CODES_PER_IMAGE)) {
    const crop = context.getImageData(region.x, region.y, region.width, region.height);
    mergeUnique(results, collectCodes(crop.data, region.width, region.height));
  }
  return results;
}

// —— 定位角检测：识别二维码三个角的 1:1:3:1:1 黑白比例特征，三个角组成直角
// 等腰三角形即框出一个候选区域。正反两种极性各扫一遍（兼顾反色码）。 ——

function detectQrRegions(data: Uint8ClampedArray, width: number, height: number): QrRegion[] {
  const clusters = [
    ...findFinderClusters(data, width, height, false),
    ...findFinderClusters(data, width, height, true),
  ]
    // 小尺寸码（模块 2~3px）因抗锯齿每行命中少，阈值须保守；误检由分组的几何约束排除
    .filter((cluster) => cluster.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 24);

  const regions = groupClustersIntoRegions(clusters, width, height);
  return dedupeRegions(regions);
}

function findFinderClusters(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  invert: boolean,
) {
  const clusters: { x: number; y: number; size: number; count: number }[] = [];

  for (let y = 0; y < height; y += 2) {
    const rowStart = y * width * 4;
    let x = 0;
    let runStart = 0;
    let runDark = isDark(data, rowStart, invert);

    while (x < width) {
      x += 1;
      const dark = x < width ? isDark(data, rowStart + x * 4, invert) : !runDark;
      if (dark !== runDark) {
        if (runDark && x >= 5) {
          const candidate = matchHorizontalRun(data, width, height, rowStart, runStart, x, y, invert);
          if (candidate) {
            mergeIntoClusters(clusters, candidate);
          }
        }
        runStart = x;
        runDark = dark;
      }
    }
  }

  return clusters;
}

function isDark(data: Uint8ClampedArray, offset: number, invert: boolean) {
  const luminance = (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000;
  return invert ? luminance >= 128 : luminance < 128;
}

function matchHorizontalRun(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rowStart: number,
  runStart: number,
  runEnd: number,
  y: number,
  invert: boolean,
) {
  // 沿行回溯取前 5 段游程，须为 深-浅-深-浅-深 且比例约 1:1:3:1:1
  const lengths = [0, 0, 0, 0];
  let cursor = runStart;
  for (let i = 3; i >= 0; i -= 1) {
    const dark = i % 2 === 0;
    let start = cursor;
    while (start > 0 && isDark(data, rowStart + (start - 1) * 4, invert) === dark) {
      start -= 1;
    }
    lengths[i] = cursor - start;
    cursor = start;
  }
  lengths[4] = runEnd - runStart;
  if (lengths.some((value) => value <= 0)) {
    return null;
  }

  const unit = lengths.reduce((sum, value) => sum + value, 0) / 7;
  if (unit < 1) {
    return null;
  }
  for (const i of [0, 1, 3, 4]) {
    if (Math.abs(lengths[i] - unit) > Math.max(1, unit * 0.6)) {
      return null;
    }
  }
  if (Math.abs(lengths[2] - unit * 3) > unit * 0.9) {
    return null;
  }

  // 定位角整体中心 = 中间 3 模块暗条的中心（当前暗条向左偏 1 浅条 + 1.5 模块）
  const centerX = runStart - lengths[3] - lengths[2] / 2;
  if (!verifyVertical(data, width, height, centerX, y, invert, unit)) {
    return null;
  }
  return { x: centerX, y, size: unit };
}

function verifyVertical(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  y: number,
  invert: boolean,
  unit: number,
) {
  const column = Math.round(centerX) * 4;
  const step = width * 4;
  const columnDark = (row: number) => isDark(data, row * step + column, invert);

  let topDarkStart = y;
  while (topDarkStart > 0 && columnDark(topDarkStart - 1)) {
    topDarkStart -= 1;
  }
  let bottomDarkEnd = y;
  while (bottomDarkEnd < height - 1 && columnDark(bottomDarkEnd + 1)) {
    bottomDarkEnd += 1;
  }
  const centerDark = bottomDarkEnd - topDarkStart + 1;
  if (Math.abs(centerDark - unit * 3) > unit * 0.9) {
    return false;
  }

  const runLength = (startRow: number, direction: -1 | 1, dark: boolean) => {
    let length = 0;
    let row = startRow;
    while (row > 0 && row < height - 1 && columnDark(row + direction) === dark) {
      row += direction;
      length += 1;
    }
    return length;
  };

  const lightUp = runLength(topDarkStart, -1, false);
  const darkUp = runLength(topDarkStart - lightUp, -1, true);
  const lightDown = runLength(bottomDarkEnd, 1, false);
  const darkDown = runLength(bottomDarkEnd + lightDown, 1, true);
  if (darkUp <= 0 || darkDown <= 0) {
    return false;
  }

  return (
    Math.abs(lightUp - unit) <= Math.max(1, unit * 0.6) &&
    Math.abs(lightDown - unit) <= Math.max(1, unit * 0.6) &&
    Math.abs(darkUp - unit) <= Math.max(1, unit * 0.6) &&
    Math.abs(darkDown - unit) <= Math.max(1, unit * 0.6)
  );
}

function mergeIntoClusters(
  clusters: { x: number; y: number; size: number; count: number }[],
  candidate: { x: number; y: number; size: number },
) {
  for (const cluster of clusters) {
    const distance = Math.hypot(cluster.x - candidate.x, cluster.y - candidate.y);
    if (distance < cluster.size * 5 && Math.abs(cluster.size - candidate.size) < cluster.size * 0.7) {
      const total = cluster.count + 1;
      cluster.x = (cluster.x * cluster.count + candidate.x) / total;
      cluster.y = (cluster.y * cluster.count + candidate.y) / total;
      cluster.size = (cluster.size * cluster.count + candidate.size) / total;
      cluster.count = total;
      return;
    }
  }
  clusters.push({ ...candidate, count: 1 });
}

function groupClustersIntoRegions(
  clusters: { x: number; y: number; size: number; count: number }[],
  width: number,
  height: number,
): QrRegion[] {
  // 枚举所有构成直角等腰三角形的组合，按几何残差升序贪心分配：
  // 每个定位角簇只属于最先选中它的组合，真实组合（残差≈0）必然优先于
  // 跨码杂合或含误检簇的组合，避免误检簇把两个码框进同一个区域。
  const candidates: { triple: { x: number; y: number; size: number; count: number }[]; residual: number }[] = [];

  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      for (let k = j + 1; k < clusters.length; k += 1) {
        const triple = [clusters[i], clusters[j], clusters[k]];
        const best = evaluateTriple(triple);
        if (best) {
          candidates.push({ triple, residual: best.residual });
        }
      }
    }
  }

  candidates.sort((a, b) => a.residual - b.residual);

  const used = new Set<number>();
  const clusterIndex = new Map(clusters.map((cluster, index) => [cluster, index]));
  const regions: QrRegion[] = [];

  for (const { triple } of candidates) {
    if (triple.some((point) => used.has(clusterIndex.get(point)!))) {
      continue;
    }
    triple.forEach((point) => used.add(clusterIndex.get(point)!));

    const margin = Math.max(10, (triple[0].size + triple[1].size + triple[2].size) * 3);
    const x0 = clamp(Math.floor(Math.min(...triple.map((p) => p.x)) - margin), 0, width - 1);
    const y0 = clamp(Math.floor(Math.min(...triple.map((p) => p.y)) - margin), 0, height - 1);
    const x1 = clamp(Math.ceil(Math.max(...triple.map((p) => p.x)) + margin), x0 + 1, width);
    const y1 = clamp(Math.ceil(Math.max(...triple.map((p) => p.y)) + margin), y0 + 1, height);
    regions.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }

  return regions;
}

// 三点构成直角等腰三角形（二维码三个定位角的布局）时返回其几何残差，否则 null
function evaluateTriple(
  triple: { x: number; y: number; size: number }[],
): { residual: number } | null {
  const maxSize = Math.max(triple[0].size, triple[1].size, triple[2].size);
  if (triple.some((point) => Math.abs(point.size - maxSize) > maxSize * 0.35)) {
    return null;
  }

  let best: { residual: number } | null = null;
  for (let corner = 0; corner < 3; corner += 1) {
    const p = triple[corner];
    const q = triple[(corner + 1) % 3];
    const r = triple[(corner + 2) % 3];
    const dq = Math.hypot(q.x - p.x, q.y - p.y);
    const dr = Math.hypot(r.x - p.x, r.y - p.y);
    if (dq <= 0 || dr <= 0 || Math.max(dq, dr) <= maxSize * 10) {
      continue;
    }
    if (Math.abs(dq - dr) > Math.max(dq, dr) * 0.2) {
      continue;
    }
    const dot = (q.x - p.x) * (r.x - p.x) + (q.y - p.y) * (r.y - p.y);
    const cosine = dot / (dq * dr);
    if (Math.abs(cosine) >= 0.25) {
      continue;
    }
    const residual = Math.abs(dq - dr) / Math.max(dq, dr) + Math.abs(cosine);
    if (!best || residual < best.residual) {
      best = { residual };
    }
  }
  return best;
}

function dedupeRegions(regions: QrRegion[]): QrRegion[] {
  const sorted = [...regions].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: QrRegion[] = [];

  for (const region of sorted) {
    const area = region.width * region.height;
    const overlapsKept = kept.some((existing) => {
      const overlapX = Math.min(existing.x + existing.width, region.x + region.width) - Math.max(existing.x, region.x);
      const overlapY = Math.min(existing.y + existing.height, region.y + region.height) - Math.max(existing.y, region.y);
      return overlapX > 0 && overlapY > 0 && overlapX * overlapY > area * 0.4;
    });
    if (!overlapsKept) {
      kept.push(region);
    }
  }

  return kept;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function deepScan(
  image: HTMLImageElement,
  originalData: ImageData,
  width: number,
  height: number,
  onStatus: (status: DecodeStatus) => void,
): Promise<string[]> {
  onStatus('deep-scan');

  const downscaled = scanDownscaledCodes(image);
  if (downscaled.length > 0) {
    return downscaled;
  }

  const strategies = [
    (data: Uint8ClampedArray) => boxBlur(data, width, height),
    (data: Uint8ClampedArray) => invertColors(data),
    (data: Uint8ClampedArray) => binarize(data, 128),
    (data: Uint8ClampedArray) => binarize(data, 80),
    (data: Uint8ClampedArray) => binarize(data, 180),
    (data: Uint8ClampedArray) => channelExtract(data, 0),
  ];

  for (const strategy of strategies) {
    await nextFrame();
    const found = collectCodes(strategy(new Uint8ClampedArray(originalData.data)), width, height);
    if (found.length > 0) {
      return found;
    }
  }

  return [];
}

function collectCodes(data: Uint8ClampedArray, width: number, height: number): string[] {
  const results: string[] = [];

  for (let i = 0; i < MAX_CODES_PER_IMAGE; i += 1) {
    const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!code?.data) {
      break;
    }
    if (!results.includes(code.data)) {
      results.push(code.data);
    }
    maskCodeLocation(data, width, height, code.location);
  }

  return results;
}

// 用白色填充二维码包围盒（含约 10% 余量盖住静区），让下一轮扫描跳过它
function maskCodeLocation(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  location: { topLeftCorner: { x: number; y: number }; topRightCorner: { x: number; y: number }; bottomRightCorner: { x: number; y: number }; bottomLeftCorner: { x: number; y: number } },
) {
  const xs = [location.topLeftCorner.x, location.topRightCorner.x, location.bottomRightCorner.x, location.bottomLeftCorner.x];
  const ys = [location.topLeftCorner.y, location.topRightCorner.y, location.bottomRightCorner.y, location.bottomLeftCorner.y];

  const padX = Math.max(4, (Math.max(...xs) - Math.min(...xs)) * 0.1);
  const padY = Math.max(4, (Math.max(...ys) - Math.min(...ys)) * 0.1);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - padX));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs) + padX));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - padY));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys) + padY));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }
}

function scanDownscaledCodes(image: HTMLImageElement): string[] {
  const width = Math.max(1, Math.floor((image.naturalWidth || image.width) / 2));
  const height = Math.max(1, Math.floor((image.naturalHeight || image.height) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = get2dContext(canvas);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return collectCodes(imageData.data, width, height);
}

async function scanWithZxing(blob: Blob): Promise<string[]> {
  try {
    const type = blob.type.startsWith('image/') ? blob.type : 'image/png';
    const decoded = await getEngine().scanFile(new File([blob], 'image.png', { type }), false);
    return decoded ? [decoded] : [];
  } catch {
    return [];
  }
}

function mergeUnique(target: string[], source: string[]) {
  for (const value of source) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function invertColors(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  return data;
}

function binarize(data: Uint8ClampedArray, threshold: number) {
  for (let i = 0; i < data.length; i += 4) {
    const average = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const value = average > threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  return data;
}

function channelExtract(data: Uint8ClampedArray, channelOffset: number) {
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i + channelOffset];
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  return data;
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number) {
  const output = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const index = ((y + ky) * width + (x + kx)) * 4;
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
        }
      }

      const centerIndex = (y * width + x) * 4;
      output[centerIndex] = red / 9;
      output[centerIndex + 1] = green / 9;
      output[centerIndex + 2] = blue / 9;
    }
  }

  return output;
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to load image.'));
    };
    image.src = objectUrl;
  });
}

function get2dContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }
  return context;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
