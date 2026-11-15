const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/theme-init.js', ['theme-init.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/supabase-client.js', ['supabase-client.js', 'text/javascript; charset=utf-8']],
  ['/node_modules/@supabase/supabase-js/dist/umd/supabase.js', ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'text/javascript; charset=utf-8']],
  ['/node_modules/xlsx/dist/xlsx.full.min.js', ['node_modules/xlsx/dist/xlsx.full.min.js', 'text/javascript; charset=utf-8']]
]);

let staticServer;

function loadLocalEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const file = staticFiles.get(pathname);
      if (!file || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const filePath = path.join(root, file[0]);
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Rounds assets are not installed. Run npm install, then restart the app.');
      });
      stream.on('open', () => {
        response.writeHead(200, {
          'Content-Type': file[1],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') {
          response.end();
          stream.destroy();
        } else {
          stream.pipe(response);
        }
      });
    });
    staticServer.once('error', reject);
    // Keep a stable local origin so Supabase Auth sessions persist between launches.
    // Port 4174 is separate from the old JSON prototype on 4173.
    staticServer.listen(4174, '127.0.0.1', () => {
      staticServer.removeListener('error', reject);
      resolve('http://127.0.0.1:4174');
    });
  });
}

function createWindow(appUrl) {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== new URL(appUrl).origin) event.preventDefault();
  });
  win.loadURL(appUrl);
}

loadLocalEnv();

app.whenReady().then(async () => {
  const appUrl = await startStaticServer();
  createWindow(appUrl);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
  });
}).catch(error => {
  console.error('Rounds could not start:', error);
  dialog.showErrorBox('Rounds could not start', error.code === 'EADDRINUSE'
    ? 'Port 4174 is already in use. Close the other app using it, then restart Rounds.'
    : error.message);
  app.quit();
});

app.on('before-quit', () => staticServer?.close());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
