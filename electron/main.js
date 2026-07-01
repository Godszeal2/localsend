const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const os = require('os');

const PORT = 5000;
let mainWindow = null;
let tray = null;
let serverProcess = null;

// ─── Find server binary ───────────────────────────────────────
function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  // Dev: look for the built Rust binary relative to this file
  const candidates = [
    path.join(__dirname, '..', 'server', 'target', 'release', 'server'),
    path.join(__dirname, '..', 'server', 'target', 'release', 'server.exe'),
  ];
  for (const c of candidates) {
    if (require('fs').existsSync(c)) return c;
  }
  return null;
}

// ─── Start the Rust server ────────────────────────────────────
function startServer() {
  const serverBin = getServerPath();
  if (!serverBin) {
    console.error('Server binary not found — run: cd server && cargo build --release');
    return;
  }

  const staticDir = app.isPackaged
    ? path.join(process.resourcesPath, 'static')
    : path.join(__dirname, '..', 'server', 'static');

  serverProcess = spawn(serverBin, [], {
    env: {
      ...process.env,
      SERVER_PORT: String(PORT),
      SERVER_IP: '0.0.0.0',
      STATIC_DIR: staticDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', d => console.log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
}

// ─── Wait for server ready ────────────────────────────────────
function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/`, res => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        attempts++;
        if (attempts >= retries) { reject(new Error('Server did not start')); return; }
        setTimeout(check, 400);
      });
      req.setTimeout(500, () => { req.destroy(); });
    };
    check();
  });
}

// ─── Get local IP for display ─────────────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ─── Create window ─────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'BridgeCast',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Open external links in real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Show local IP in title bar for phone connection
  const ip = getLocalIP();
  mainWindow.setTitle(`BridgeCast  —  Phone connect: http://${ip}:${PORT}`);
}

// ─── Tray icon ────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const ip = getLocalIP();

  const menu = Menu.buildFromTemplate([
    { label: `BridgeCast  v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: `Phone URL: http://${ip}:${PORT}`, enabled: false },
    { label: 'Copy Phone URL', click: () => require('electron').clipboard.writeText(`http://${ip}:${PORT}`) },
    { type: 'separator' },
    { label: 'Open', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { label: 'Quit', click: () => { stopServer(); app.quit(); } },
  ]);

  tray.setToolTip(`BridgeCast — http://${ip}:${PORT}`);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWindow) mainWindow.show(); else createWindow(); });
}

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(async () => {
  startServer();
  try { await waitForServer(); } catch (e) {
    dialog.showErrorBox('BridgeCast', 'Server failed to start.\n\nMake sure you built it first:\n  cd server && cargo build --release');
    app.quit(); return;
  }
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running in tray on all platforms
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', () => stopServer());

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}
