import { decodeQrBlob } from '../shared/decode';
import { hidePanel, setPanelState, showPanel } from './panel';

const TASK_TYPE = 'qr-recognize-task';

declare global {
  interface Window {
    __qrReaderExtLoaded?: boolean;
  }
}

if (!window.__qrReaderExtLoaded) {
  window.__qrReaderExtLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === TASK_TYPE) {
      void runTask(message.dataUrl as string | undefined, message.srcUrl as string | undefined);
      sendResponse({ received: true });
    }
  });
}

async function runTask(dataUrl: string | undefined, srcUrl: string | undefined) {
  showPanel();
  setPanelState({ kind: 'loading', status: 'analyzing' });

  try {
    const blob = await loadBlob(dataUrl, srcUrl);
    const results = await decodeQrBlob(blob, (status) => {
      setPanelState({ kind: 'loading', status });
    });
    setPanelState({ kind: 'success', results, thumbnail: dataUrl ?? srcUrl ?? '' });
  } catch {
    setPanelState({ kind: 'error' });
  }
}

async function loadBlob(dataUrl: string | undefined, srcUrl: string | undefined): Promise<Blob> {
  if (dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  if (!srcUrl) {
    throw new Error('No image source.');
  }

  // background 抓取失败（防盗链等）时的兜底：blob: / 同源 / 允许跨域的图片可以在这里取到
  const response = await fetch(srcUrl);
  if (!response.ok) {
    throw new Error(`Fetch image failed: ${response.status}`);
  }
  return response.blob();
}

window.addEventListener('pagehide', hidePanel);
