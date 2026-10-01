const MENU_ID = 'qr-recognize';
const TASK_TYPE = 'qr-recognize-task';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '识别二维码',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) {
    return;
  }

  const tabId = tab.id;
  const frameId = info.frameId ?? 0;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ['content.js'],
    });
  } catch {
    return;
  }

  // blob: URL 是页面私有，service worker 抓不到，交给 content script 自己取；
  // 其余（http/https/data）在 SW 里抓可绕过页面 CORS 限制。
  let dataUrl: string | undefined;
  if (!info.srcUrl.startsWith('blob:')) {
    dataUrl = await fetchAsDataUrl(info.srcUrl).catch(() => undefined);
  }

  chrome.tabs
    .sendMessage(tabId, { type: TASK_TYPE, dataUrl, srcUrl: info.srcUrl }, { frameId })
    .catch(() => {});
});

async function fetchAsDataUrl(srcUrl: string): Promise<string | undefined> {
  const response = await fetch(srcUrl);
  if (!response.ok) {
    return undefined;
  }

  const buffer = await response.arrayBuffer();
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
  return `data:${mime && mime.startsWith('image/') ? mime : 'image/png'};base64,${toBase64(buffer)}`;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}
