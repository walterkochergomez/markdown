// ============================================================
//  MarkItDown Web — app.js
//  Runs microsoft/markitdown inside the browser via Pyodide
// ============================================================

const $ = id => document.getElementById(id);

const UI = {
  statusDot:     $('statusDot'),
  statusText:    $('statusText'),
  dropZone:      $('dropZone'),
  fileInput:     $('fileInput'),
  btnSelect:     $('btnSelect'),
  btnUrl:        $('btnUrl'),
  ytUrl:         $('ytUrl'),
  progressWrap:  $('progressWrap'),
  progressFill:  $('progressFill'),
  progressLabel: $('progressLabel'),
  resultSection: $('resultSection'),
  resultFilename:$('resultFilename'),
  resultChars:   $('resultChars'),
  mdRaw:         $('mdRaw'),
  mdPreview:     $('mdPreview'),
  tabRaw:        $('tabRaw'),
  tabPreview:    $('tabPreview'),
  btnCopy:       $('btnCopy'),
  btnDownload:   $('btnDownload'),
  btnReset:      $('btnReset'),
  errorBox:      $('errorBox'),
  errorMsg:      $('errorMsg'),
};

let pyodide = null;
let currentMarkdown = '';
let currentFilename = 'output';

// ─── Status helpers ──────────────────────────────────────────
function setStatus(state, text) {
  UI.statusDot.className = 'status-dot ' + state;
  UI.statusText.textContent = text;
}

function setProgress(pct, label) {
  UI.progressWrap.style.display = 'flex';
  UI.progressFill.style.width = pct + '%';
  UI.progressLabel.textContent = label;
}

function hideProgress() {
  UI.progressWrap.style.display = 'none';
  UI.progressFill.style.width = '0%';
}

function showError(msg) {
  UI.errorBox.style.display = 'flex';
  UI.errorMsg.textContent = msg;
  UI.resultSection.style.display = 'none';
  hideProgress();
}

function hideError() {
  UI.errorBox.style.display = 'none';
}

// ─── Pyodide bootstrap ───────────────────────────────────────
async function initPyodide() {
  setStatus('loading', 'Cargando Python (Pyodide)...');
  try {
    pyodide = await loadPyodide();
    setProgress(30, 'Instalando micropip...');
    await pyodide.loadPackage('micropip');

    setProgress(55, 'Instalando dependencias de MarkItDown...');
    await pyodide.runPythonAsync(`
import micropip
import sys
from unittest.mock import MagicMock

# 1. Registramos el paquete falso para evadir el error de IA
micropip.add_mock_package("onnxruntime", "1.17.0")

# 2. Inyectamos el módulo simulado
sys.modules["onnxruntime"] = MagicMock()

# 3. Instalamos MarkItDown con TODOS sus extras (PDF, Word, Excel, YouTube, etc.)
await micropip.install('markitdown[all]', keep_going=True)
`);

    setProgress(90, 'Inicializando MarkItDown...');
    await pyodide.runPythonAsync(`
from markitdown import MarkItDown
import io, os, sys

_md = MarkItDown()

# Parche 2.0: Estructura exacta que espera Magika
class MockOutput:
    label = 'unknown'
    mime_type = 'unknown'

class MockPrediction:
    output = MockOutput()

class MockResult:
    status = 'ok'
    prediction = MockPrediction()

class MockMagika:
    def identify_stream(self, stream):
        return MockResult()
    
    def identify_path(self, path):
        return MockResult()

_md._magika = MockMagika()
`);
    setProgress(100, 'Listo');

    setTimeout(() => {
      hideProgress();
      setStatus('ready', 'Python listo · MarkItDown cargado');
      UI.dropZone.classList.remove('disabled');
      UI.btnUrl.disabled = false;
    }, 400);

  } catch (err) {
    setStatus('error', 'Error al cargar Pyodide');
    showError('No se pudo inicializar Pyodide/MarkItDown: ' + err.message);
    console.error(err);
  }
}

// ─── Conversion core ─────────────────────────────────────────

/**
 * Convert a File object using markitdown running in Pyodide.
 * We write the bytes to Pyodide's virtual FS, convert, then clean up.
 */
async function convertFile(file) {
  hideError();
  setStatus('loading', 'Convirtiendo ' + file.name + '...');
  setProgress(10, 'Leyendo archivo...');

  const bytes = new Uint8Array(await file.arrayBuffer());

  setProgress(35, 'Enviando a Pyodide...');
  pyodide.FS.writeFile('/tmp/' + file.name, bytes);

  setProgress(60, 'Ejecutando MarkItDown...');
  const result = await pyodide.runPythonAsync(`
import traceback
try:
    r = _md.convert('/tmp/${escapeFilename(file.name)}')
    out = r.text_content
except Exception as e:
    out = '##ERROR##' + traceback.format_exc()
out
`);
  pyodide.FS.unlink('/tmp/' + file.name);

  if (typeof result === 'string' && result.startsWith('##ERROR##')) {
    throw new Error(result.replace('##ERROR##', '').trim());
  }

  setProgress(100, 'Conversión completa');
  return typeof result === 'string' ? result : result.toString();
}

/**
 * Convert a YouTube / remote URL using markitdown.
 */
async function convertUrl(url) {
  hideError();
  setStatus('loading', 'Convirtiendo URL...');
  setProgress(20, 'Enviando URL a MarkItDown...');

  const safeUrl = url.replace(/'/g, "\\'");
  const result = await pyodide.runPythonAsync(`
import traceback
try:
    r = _md.convert('${safeUrl}')
    out = r.text_content
except Exception as e:
    out = '##ERROR##' + traceback.format_exc()
out
`);

  if (typeof result === 'string' && result.startsWith('##ERROR##')) {
    throw new Error(result.replace('##ERROR##', '').trim());
  }

  setProgress(100, 'Conversión completa');
  return typeof result === 'string' ? result : result.toString();
}

function escapeFilename(name) {
  return name.replace(/['"\\]/g, '_');
}

// ─── Show result ─────────────────────────────────────────────
function showResult(markdown, filename) {
  currentMarkdown = markdown;
  currentFilename = filename.replace(/\.[^.]+$/, '') || 'output';

  UI.mdRaw.textContent = markdown;
  UI.resultFilename.textContent = currentFilename + '.md';
  UI.resultChars.textContent = formatNum(markdown.length) + ' chars · ' + formatNum(markdown.split('\n').length) + ' líneas';

  // Preview
  if (typeof marked !== 'undefined') {
    UI.mdPreview.innerHTML = marked.parse(markdown);
  }

  setTimeout(() => {
    hideProgress();
    UI.resultSection.style.display = 'block';
    setStatus('ready', 'Conversión exitosa · ' + currentFilename + '.md');
    UI.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

function formatNum(n) {
  return n.toLocaleString('es-CL');
}

// ─── Tabs ─────────────────────────────────────────────────────
UI.tabRaw.addEventListener('click', () => {
  UI.tabRaw.classList.add('active');
  UI.tabPreview.classList.remove('active');
  UI.mdRaw.style.display = '';
  UI.mdPreview.style.display = 'none';
});

UI.tabPreview.addEventListener('click', () => {
  UI.tabPreview.classList.add('active');
  UI.tabRaw.classList.remove('active');
  UI.mdRaw.style.display = 'none';
  UI.mdPreview.style.display = '';
});

// ─── Copy & Download ──────────────────────────────────────────
UI.btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    UI.btnCopy.classList.add('copied');
    UI.btnCopy.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10l5 5 7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ¡Copiado!`;
    setTimeout(() => {
      UI.btnCopy.classList.remove('copied');
      UI.btnCopy.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.5"/></svg> Copiar`;
    }, 2000);
  } catch (e) {
    alert('No se pudo copiar: ' + e.message);
  }
});

UI.btnDownload.addEventListener('click', () => {
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentFilename + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ─── Reset ───────────────────────────────────────────────────
UI.btnReset.addEventListener('click', () => {
  UI.resultSection.style.display = 'none';
  UI.fileInput.value = '';
  UI.ytUrl.value = '';
  hideError();
  currentMarkdown = '';
  currentFilename = 'output';
  // Reset tabs
  UI.tabRaw.classList.add('active');
  UI.tabPreview.classList.remove('active');
  UI.mdRaw.style.display = '';
  UI.mdPreview.style.display = 'none';
});

// ─── File input via button ────────────────────────────────────
UI.btnSelect.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!pyodide) return;
  UI.fileInput.click();
});

UI.dropZone.addEventListener('click', () => {
  if (!pyodide) return;
  UI.fileInput.click();
});

UI.fileInput.addEventListener('change', async () => {
  const file = UI.fileInput.files[0];
  if (!file) return;
  try {
    const md = await convertFile(file);
    showResult(md, file.name);
  } catch (err) {
    setStatus('error', 'Error en la conversión');
    showError(err.message);
  }
});

// ─── Drag & drop ─────────────────────────────────────────────
UI.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!pyodide) return;
  UI.dropZone.classList.add('dragover');
});

UI.dropZone.addEventListener('dragleave', () => {
  UI.dropZone.classList.remove('dragover');
});

UI.dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  UI.dropZone.classList.remove('dragover');
  if (!pyodide) return;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const md = await convertFile(file);
    showResult(md, file.name);
  } catch (err) {
    setStatus('error', 'Error en la conversión');
    showError(err.message);
  }
});

// ─── YouTube / URL ────────────────────────────────────────────
UI.ytUrl.addEventListener('input', () => {
  const val = UI.ytUrl.value.trim();
  UI.btnUrl.disabled = !pyodide || !val;
});

UI.btnUrl.addEventListener('click', async () => {
  const url = UI.ytUrl.value.trim();
  if (!url || !pyodide) return;
  try {
    const md = await convertUrl(url);
    const label = url.includes('youtube') ? 'youtube-transcript' : 'url-content';
    showResult(md, label);
  } catch (err) {
    setStatus('error', 'Error en la conversión');
    showError(err.message);
  }
});

// ─── Keyboard shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && currentMarkdown) {
    // Ctrl+C handled by copy button; do nothing globally
  }
  // Escape to reset
  if (e.key === 'Escape' && UI.resultSection.style.display !== 'none') {
    UI.btnReset.click();
  }
});

// ─── Paste a URL via Ctrl+V on empty ytUrl ────────────────────
UI.ytUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') UI.btnUrl.click();
});

// ─── Boot ────────────────────────────────────────────────────
UI.dropZone.classList.add('disabled');
initPyodide();
