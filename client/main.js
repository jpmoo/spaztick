const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Reduce "tile memory limits exceeded" warnings from Chromium compositor (e.g. with many task cards).
// Omit this if you prefer maximum GPU compositing and don't see drawing issues.
app.commandLine.appendSwitch('disable-gpu-compositing');

function openExternalUrl(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u.startsWith('http://') && !u.startsWith('https://')) return Promise.resolve();
  return shell.openExternal(u).catch(() => {
    const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
    return new Promise((resolve, reject) => {
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });
  });
}

ipcMain.handle('open-external-url', async (_event, url) => {
  await openExternalUrl(url);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Spaztick',
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(url);
    } catch (_) {}
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.maximize();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
