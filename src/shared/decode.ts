import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';

export type DecodeStatus = 'analyzing' | 'deep-scan';

const ENGINE_ELEMENT_ID = '__qr-reader-ext-engine';

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

export async function decodeQrBlob(
  blob: Blob,
  onStatus: (status: DecodeStatus) => void,
): Promise<string> {
  onStatus('analyzing');

  try {
    const type = blob.type.startsWith('image/') ? blob.type : 'image/png';
    return await getEngine().scanFile(new File([blob], 'image.png', { type }), false);
  } catch {
    return bruteForceScan(blob, onStatus);
  }
}

async function bruteForceScan(blob: Blob, onStatus: (status: DecodeStatus) => void) {
  onStatus('deep-scan');

  const image = await loadImage(blob);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth || image.width;
  sourceCanvas.height = image.naturalHeight || image.height;

  const sourceContext = get2dContext(sourceCanvas);
  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const originalData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const strategies = [
    (data: Uint8ClampedArray) => data,
    (data: Uint8ClampedArray) => boxBlur(data, sourceCanvas.width, sourceCanvas.height),
    (data: Uint8ClampedArray) => invertColors(data),
    (data: Uint8ClampedArray) => binarize(data, 128),
    (data: Uint8ClampedArray) => binarize(data, 80),
    (data: Uint8ClampedArray) => binarize(data, 180),
    (data: Uint8ClampedArray) => channelExtract(data, 0),
  ];

  const downscaledCode = scanDownscaled(image);
  if (downscaledCode) {
    return downscaledCode;
  }

  for (const strategy of strategies) {
    await nextFrame();
    const cleanData = new Uint8ClampedArray(originalData.data);
    const processedData = strategy(cleanData);
    const code = jsQR(processedData, sourceCanvas.width, sourceCanvas.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (code?.data) {
      return code.data;
    }
  }

  throw new Error('No QR code found in the image.');
}

function scanDownscaled(image: HTMLImageElement) {
  const width = Math.max(1, Math.floor((image.naturalWidth || image.width) / 2));
  const height = Math.max(1, Math.floor((image.naturalHeight || image.height) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = get2dContext(canvas);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  return jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
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
