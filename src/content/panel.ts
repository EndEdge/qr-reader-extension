export type PanelState =
  | { kind: 'loading'; status: 'analyzing' | 'deep-scan' }
  | { kind: 'success'; results: string[]; thumbnail: string }
  | { kind: 'error' };

const HOST_ID = '__qr-reader-ext-panel';
const TOAST_DURATION_MS = 1800;

const STYLE = `
  :host {
    all: initial;
    position: fixed;
    inset: auto 0 0 auto;
    z-index: 2147483647;
  }
  * { box-sizing: border-box; }
  .card {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 340px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 20px 45px -12px rgba(15, 23, 42, .28);
    color: #0f172a;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
  }
  .title { font-weight: 600; }
  .close {
    border: 0;
    background: transparent;
    color: #94a3b8;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .close:hover { color: #2563eb; background: #eff6ff; }
  .body { padding: 14px 16px 16px; }
  .loading { display: none; flex-direction: column; align-items: center; gap: 10px; padding: 22px 0; }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid #dbeafe;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: qr-ext-spin .8s linear infinite;
  }
  @keyframes qr-ext-spin { to { transform: rotate(360deg); } }
  .status { color: #2563eb; font-weight: 500; }
  .success { display: none; flex-direction: column; gap: 10px; }
  .badge-row { display: flex; align-items: center; gap: 8px; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #ecfdf5;
    color: #047857;
    font-size: 12px;
    font-weight: 600;
  }
  .count { font-size: 12px; color: #64748b; font-weight: 600; }
  .thumb {
    max-width: 100%;
    max-height: 140px;
    align-self: center;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    object-fit: contain;
  }
  .results { display: flex; flex-direction: column; gap: 14px; }
  .result-item { display: flex; flex-direction: column; gap: 6px; }
  .index { font-size: 12px; font-weight: 600; color: #64748b; }
  .result-wrap { position: relative; }
  .result {
    width: 100%;
    height: 96px;
    resize: none;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
    padding: 10px 44px 10px 12px;
    color: #1e293b;
    font-family: Consolas, Menlo, monospace;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
  }
  .result:focus { border-color: #93c5fd; box-shadow: 0 0 0 3px #dbeafe; }
  .copy {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 30px;
    height: 30px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #ffffff;
    color: #64748b;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .copy:hover { color: #2563eb; border-color: #93c5fd; }
  .visit {
    display: block;
    text-align: center;
    padding: 8px;
    border-radius: 8px;
    background: #2563eb;
    color: #ffffff;
    font-weight: 600;
    text-decoration: none;
  }
  .visit:hover { background: #1d4ed8; }
  .error {
    display: none;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid #fecdd3;
    border-radius: 8px;
    background: #fff1f2;
    color: #be123c;
  }
  .error-title { font-weight: 600; }
  .error-message { margin: 0; font-size: 13px; color: #e11d48; }
  .card.is-loading .loading { display: flex; }
  .card.is-success .success { display: flex; }
  .card.is-error .error { display: flex; }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translate(-50%, 8px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border-radius: 999px;
    background: #0f172a;
    color: #ffffff;
    font-size: 13px;
    opacity: 0;
    pointer-events: none;
    transition: opacity .25s, transform .25s;
  }
  .toast.toast-show { opacity: 1; transform: translate(-50%, 0); }
`;

const TEMPLATE = `
  <div class="card is-loading">
    <div class="header">
      <span class="title">二维码识别</span>
      <button class="close" title="关闭" aria-label="关闭">&times;</button>
    </div>
    <div class="body">
      <div class="loading">
        <div class="spinner"></div>
        <div class="status">正在分析...</div>
      </div>
      <div class="success">
        <div class="badge-row">
          <span class="badge">&#10003; SUCCESS</span>
          <span class="count"></span>
        </div>
        <img class="thumb" alt="已识别图片预览" />
        <div class="results"></div>
      </div>
      <div class="error">
        <span class="error-title">无法识别</span>
        <p class="error-message">未能从图片中提取出有效二维码内容，请尝试裁剪图片，仅保留二维码区域。</p>
      </div>
    </div>
    <div class="toast">&#10003; 已复制</div>
  </div>
`;

export function showPanel() {
  getRoot();
}

export function setPanelState(state: PanelState) {
  const root = getRoot();
  const card = root.querySelector<HTMLElement>('.card')!;
  const statusText = root.querySelector<HTMLElement>('.status')!;

  card.classList.remove('is-loading', 'is-success', 'is-error');

  if (state.kind === 'loading') {
    card.classList.add('is-loading');
    statusText.textContent = state.status === 'deep-scan' ? '正在深度识别...' : '正在分析...';
    return;
  }

  if (state.kind === 'error') {
    card.classList.add('is-error');
    return;
  }

  card.classList.add('is-success');
  (root.querySelector('.count') as HTMLElement).textContent =
    state.results.length > 1 ? `共 ${state.results.length} 个结果` : '';
  (root.querySelector('.thumb') as HTMLImageElement).src = state.thumbnail;
  renderResults(root, state.results);
}

function renderResults(root: ShadowRoot, results: string[]) {
  const list = root.querySelector('.results')!;
  list.innerHTML = '';

  results.forEach((text, index) => {
    const item = document.createElement('div');
    item.className = 'result-item';

    if (results.length > 1) {
      const tag = document.createElement('span');
      tag.className = 'index';
      tag.textContent = `#${index + 1}`;
      item.appendChild(tag);
    }

    const wrap = document.createElement('div');
    wrap.className = 'result-wrap';

    const textarea = document.createElement('textarea');
    textarea.className = 'result';
    textarea.readOnly = true;
    textarea.spellcheck = false;
    textarea.value = text;

    const copyButton = document.createElement('button');
    copyButton.className = 'copy';
    copyButton.title = '复制';
    copyButton.innerHTML = '&#128203;';
    copyButton.addEventListener('click', () => {
      void copyResult(root, textarea.value);
    });

    wrap.append(textarea, copyButton);
    item.appendChild(wrap);

    if (isValidUrl(text)) {
      const visit = document.createElement('a');
      visit.className = 'visit';
      visit.target = '_blank';
      visit.rel = 'noreferrer';
      visit.href = text;
      visit.innerHTML = '&#8599; 访问链接';
      item.appendChild(visit);
    }

    list.appendChild(item);
  });
}

export function hidePanel() {
  document.getElementById(HOST_ID)?.remove();
  document.removeEventListener('keydown', onKeyDown);
}

function getRoot(): ShadowRoot {
  const existing = document.getElementById(HOST_ID)?.shadowRoot;
  if (existing) {
    return existing;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  (document.body ?? document.documentElement).appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
  root.querySelector('.close')!.addEventListener('click', hidePanel);
  document.addEventListener('keydown', onKeyDown);
  return root;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    hidePanel();
  }
}

async function copyResult(root: ShadowRoot, text: string) {
  if (!text || !(await copyText(text))) {
    return;
  }

  const toast = root.querySelector<HTMLElement>('.toast')!;
  toast.classList.add('toast-show');
  window.setTimeout(() => toast.classList.remove('toast-show'), TOAST_DURATION_MS);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    (document.body ?? document.documentElement).appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    return ok;
  }
}

function isValidUrl(value: string) {
  try {
    if (!/^https?:\/\//i.test(value)) {
      return false;
    }
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
