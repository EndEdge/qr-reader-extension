import { decodeQrBlob, type DecodeStatus } from '../shared/decode';

const elements = {
  dropzone: document.getElementById('dropzone') as HTMLDivElement,
  fileInput: document.getElementById('file-input') as HTMLInputElement,
  dropHint: document.getElementById('drop-hint') as HTMLElement,
  preview: document.getElementById('preview') as HTMLImageElement,
  scanOverlay: document.getElementById('scan-overlay') as HTMLDivElement,
  scanStatus: document.getElementById('scan-status') as HTMLElement,
  resultArea: document.getElementById('result-area') as HTMLDivElement,
  resultCount: document.getElementById('result-count') as HTMLElement,
  resultList: document.getElementById('result-list') as HTMLDivElement,
  errorBox: document.getElementById('error-box') as HTMLDivElement,
  toast: document.getElementById('toast') as HTMLDivElement,
};

let previewUrl: string | null = null;
let toastTimer = 0;

elements.dropzone.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => {
  const file = elements.fileInput.files?.[0];
  if (file) {
    void handleFile(file);
  }
});

elements.dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.dropzone.classList.add('drag-active');
});
elements.dropzone.addEventListener('dragleave', () => {
  elements.dropzone.classList.remove('drag-active');
});
elements.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove('drag-active');
  const file = event.dataTransfer?.files[0];
  if (file) {
    void handleFile(file);
  }
});

document.addEventListener('paste', (event) => {
  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  const blob = imageItem?.getAsFile();

  if (blob) {
    void handleFile(new File([blob], 'pasted-image.png', { type: blob.type }));
  }
});

async function handleFile(file: File) {
  if (!file.type.startsWith('image/')) {
    showError();
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  previewUrl = URL.createObjectURL(file);
  elements.preview.src = previewUrl;
  elements.preview.style.display = 'block';
  elements.dropHint.style.display = 'none';
  elements.resultArea.classList.remove('visible');
  elements.errorBox.classList.remove('visible');
  elements.scanOverlay.classList.add('visible');
  setScanStatus('analyzing');

  try {
    const results = await decodeQrBlob(file, setScanStatus);
    renderResults(results);
    elements.resultArea.classList.add('visible');
  } catch {
    showError();
  } finally {
    elements.fileInput.value = '';
    elements.scanOverlay.classList.remove('visible');
  }
}

function renderResults(results: string[]) {
  elements.resultCount.textContent = results.length > 1 ? `共 ${results.length} 个结果` : '';
  elements.resultList.innerHTML = '';

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
    textarea.readOnly = true;
    textarea.spellcheck = false;
    textarea.value = text;

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-btn';
    copyButton.title = '复制';
    copyButton.innerHTML = '&#128203;';
    copyButton.addEventListener('click', () => {
      void copyResult(textarea.value);
    });

    wrap.append(textarea, copyButton);
    item.appendChild(wrap);

    if (isValidUrl(text)) {
      const visit = document.createElement('a');
      visit.className = 'visit-btn';
      visit.target = '_blank';
      visit.rel = 'noreferrer';
      visit.href = text;
      visit.innerHTML = '&#8599; 访问链接';
      item.appendChild(visit);
    }

    elements.resultList.appendChild(item);
  });
}

function setScanStatus(status: DecodeStatus) {
  elements.scanStatus.textContent = status === 'deep-scan' ? '正在深度识别...' : '正在分析...';
}

function showError() {
  elements.resultArea.classList.remove('visible');
  elements.errorBox.classList.add('visible');
}

async function copyResult(text: string) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand('copy');
    scratch.remove();
  }

  elements.toast.classList.add('toast-show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('toast-show'), 1800);
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
