import { decodeQrBlob, type DecodeStatus } from '../shared/decode';

const elements = {
  dropzone: document.getElementById('dropzone') as HTMLDivElement,
  fileInput: document.getElementById('file-input') as HTMLInputElement,
  dropHint: document.getElementById('drop-hint') as HTMLElement,
  preview: document.getElementById('preview') as HTMLImageElement,
  scanOverlay: document.getElementById('scan-overlay') as HTMLDivElement,
  scanStatus: document.getElementById('scan-status') as HTMLElement,
  resultArea: document.getElementById('result-area') as HTMLDivElement,
  result: document.getElementById('result') as HTMLTextAreaElement,
  copyButton: document.getElementById('copy-btn') as HTMLButtonElement,
  visitButton: document.getElementById('visit-btn') as HTMLAnchorElement,
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

elements.copyButton.addEventListener('click', () => {
  void copyResult();
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
    const result = await decodeQrBlob(file, setScanStatus);
    elements.result.value = result;

    if (isValidUrl(result)) {
      elements.visitButton.href = result;
      elements.visitButton.style.display = 'block';
    } else {
      elements.visitButton.style.display = 'none';
    }

    elements.resultArea.classList.add('visible');
  } catch {
    showError();
  } finally {
    elements.fileInput.value = '';
    elements.scanOverlay.classList.remove('visible');
  }
}

function setScanStatus(status: DecodeStatus) {
  elements.scanStatus.textContent = status === 'deep-scan' ? '正在深度识别...' : '正在分析...';
}

function showError() {
  elements.resultArea.classList.remove('visible');
  elements.errorBox.classList.add('visible');
}

async function copyResult() {
  if (!elements.result.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(elements.result.value);
  } catch {
    elements.result.select();
    document.execCommand('copy');
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
