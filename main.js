// main.js — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');

const SETTINGS = path.join(app.getPath('userData'), 'subtranslate-settings.json');
// Resolve the Ollama host: explicit per-call host (from UI settings) → env → default.
const resolveHost = (host) => (host && host.trim()) || process.env.OLLAMA_URL || engine.DEFAULT_OLLAMA;

// Avoids the GPU-process crash that can close the window on some setups.
app.disableHardwareAcceleration();

let win;
let abortController = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 980, minWidth: 900, minHeight: 640,
    backgroundColor: '#0B0D10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC: Ollama models (reachability + installed models) ──
ipcMain.handle('list-models', async (_e, host) => {
  const baseUrl = resolveHost(host);
  const status = await engine.checkOllama(baseUrl);   // never throws; short timeout
  if (!status.reachable) {
    console.warn(`[ollama] not reachable at ${baseUrl}: ${status.error}`);
    return { ok: false, error: status.error, models: [], host: baseUrl };
  }
  return { ok: true, models: status.models.map((name) => ({ name })), host: baseUrl };
});

// ── IPC: open a .srt ──────────────────────────────────────
ipcMain.handle('pick-srt', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open subtitle file', properties: ['openFile'],
    filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const content = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  return { name: path.basename(p), path: p, content };
});

// ── IPC: open a glossary/text file ────────────────────────
ipcMain.handle('pick-text', async (_e, { title, extensions }) => {
  const r = await dialog.showOpenDialog(win, {
    title: title || 'Open file', properties: ['openFile'],
    filters: [{ name: 'Text', extensions: extensions || ['txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), path: p, content: fs.readFileSync(p, 'utf8').replace(/^﻿/, '') };
});

// ── IPC: save text (srt / glossary) ───────────────────────
ipcMain.handle('save-text', async (_e, { defaultName, text }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: defaultName });
  if (r.canceled || !r.filePath) return { saved: false };
  fs.writeFileSync(r.filePath, text, 'utf8');
  return { saved: true, path: r.filePath };
});

ipcMain.handle('reveal', async (_e, p) => { if (p) shell.showItemInFolder(p); });

// ── IPC: resize the window to a 9:16 (vertical) or wide aspect ────
ipcMain.handle('set-window-mode', (_e, mode) => {
  if (!win) return null;
  if (mode === 'vertical') {
    if (!win._wideSize) win._wideSize = win.getSize();           // remember wide size
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const h = Math.max(600, Math.min(wa.height, 1040));
    const w = Math.round(h * 9 / 16);                            // exact 9:16
    win.setMinimumSize(360, 600);
    win.setSize(w, h);
    win.center();
  } else {
    const [w, h] = win._wideSize || [1500, 980];
    win.setMinimumSize(900, 640);
    win.setSize(w, h);
    win.center();
  }
  return win.getSize();
});

// ── IPC: choose a destination folder ──────────────────────
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose destination folder', properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

// ── IPC: write a file directly to dir/name (no dialog) ────
// Won't overwrite an existing file unless { overwrite:true } — the renderer asks
// the user to confirm first, so the original subtitle file is never clobbered silently.
ipcMain.handle('write-file', async (_e, { dir, name, text, overwrite }) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    if (!overwrite && fs.existsSync(p)) return { saved: false, exists: true, path: p };
    fs.writeFileSync(p, text, 'utf8');
    return { saved: true, path: p };
  } catch (e) {
    return { saved: false, error: e.message };
  }
});

// ── IPC: extract proper-noun candidates -> glossary template
ipcMain.handle('extract-names', async (_e, { srtText, sourceName }) => {
  const entries = engine.parseSrt(srtText);
  const candidates = engine.extractNameCandidates(entries);
  return { template: engine.glossaryTemplate(candidates, sourceName || 'subtitles.srt'),
    rows: candidates.map(([term, count]) => ({ term, count })) };
});

// ── IPC: build first-batch prompt preview (no Ollama call) ─
ipcMain.handle('preview-prompt', async (_e, opts) => {
  const entries = engine.parseSrt(opts.srtText || '');
  const sel = engine.resolveSelection(opts.rangeMode || 'all', opts.rangeN || 30, opts.rangeA || 1, opts.rangeB || 100, entries.length || 1);
  const chunk = entries.slice(sel.start0, sel.end);
  const groups = engine.buildGroups(chunk, opts.sentenceMode !== false, opts.maxGroupBlocks || 4);
  const texts = groups.slice(0, opts.batchSize || 20).map((g) => g.text);
  return engine.buildPrompt(texts, opts.srcLang || '', opts.tgtLang || 'Hebrew',
    engine.loadGlossary(opts.glossaryText || ''), opts.primer || '', [], opts.summary || '');
});

// ── IPC: translate ────────────────────────────────────────
ipcMain.handle('translate', async (event, opts) => {
  abortController = new AbortController();
  try {
    const result = await engine.translateAll(
      { ...opts, baseUrl: resolveHost(opts.host) },
      (p) => { if (!event.sender.isDestroyed()) event.sender.send('translate:progress', p); },
      abortController.signal,
    );
    return { ok: true, ...result };
  } catch (e) {
    if (e.message !== 'cancelled') console.error('[translate] failed:', e.message);
    return { ok: false, error: e.message };
  } finally {
    abortController = null;
  }
});

ipcMain.handle('cancel-translate', async () => { if (abortController) abortController.abort(); return true; });

// ── IPC: settings persistence ─────────────────────────────
ipcMain.handle('load-settings', async () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
});
ipcMain.handle('save-settings', async (_e, data) => {
  try { fs.writeFileSync(SETTINGS, JSON.stringify(data, null, 2), 'utf8'); } catch {}
  return true;
});
