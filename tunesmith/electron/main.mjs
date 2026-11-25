// Tunesmith desktop shell: opens the app window, keeps the Claude API key
// (encrypted with the operating system's keychain), and talks to Claude.

import { app, BrowserWindow, ipcMain, safeStorage, session, shell, dialog } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askClaude } from './claude.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(s) {
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(s, null, 2));
}

async function storedKey() {
  const s = await readSettings();
  if (!s.apiKey) return null;
  try {
    if (!s.encrypted) return Buffer.from(s.apiKey, 'base64').toString('utf8');
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(s.apiKey, 'base64'));
    if (shouldReEncrypt) await saveKey(result);
    return result;
  } catch {
    return null;
  }
}

async function saveKey(key) {
  const s = await readSettings();
  if (!key) {
    delete s.apiKey;
    delete s.encrypted;
  } else {
    const secure = await safeStorage.isAsyncEncryptionAvailable();
    s.apiKey = secure ? (await safeStorage.encryptStringAsync(key)).toString('base64') : Buffer.from(key).toString('base64');
    s.encrypted = secure;
  }
  await writeSettings(s);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#13151b',
    title: 'Tunesmith',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu?.();
  win.loadFile(path.join(here, '..', 'app', 'index.html'));
  // Links open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Self-test used by CI: load, report status, save a screenshot, quit.
  if (process.env.TUNESMITH_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const result = await win.webContents.executeJavaScript('JSON.stringify({ title: document.title, ready: !!window.__tunesmithReady, desktop: !!window.tunesmith, errors: window.__errors || [] })');
      const img = await win.webContents.capturePage();
      await writeFile(process.env.TUNESMITH_SMOKE, img.toPNG());
      console.log('SMOKE', result);
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  // Microphone (for humming) and MIDI keyboards are the only permissions the app asks for.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'midi'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'midi'].includes(permission));

  ipcMain.handle('ai:status', async () => {
    const key = await storedKey();
    return { hasKey: !!key || !!process.env.ANTHROPIC_API_KEY, saved: !!key, secure: await safeStorage.isAsyncEncryptionAvailable() };
  });

  ipcMain.handle('ai:setKey', async (_e, key) => {
    await saveKey(key ? String(key).trim() : null);
    return { ok: true };
  });

  ipcMain.handle('ai:suggest', async (_e, payload) => {
    const apiKey = (await storedKey()) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, needsKey: true, error: 'Add your Claude API key in Settings first.' };
    return askClaude(apiKey, payload);
  });

  ipcMain.handle('file:save', async (_e, { name, data, filters }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: name, filters });
    if (canceled || !filePath) return { ok: false };
    await writeFile(filePath, typeof data === 'string' ? data : Buffer.from(data));
    return { ok: true, path: filePath };
  });

  ipcMain.handle('file:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'Tunesmith song', extensions: ['tunesmith', 'json'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return { ok: false };
    return { ok: true, text: await readFile(filePaths[0], 'utf8'), name: path.basename(filePaths[0]) };
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
