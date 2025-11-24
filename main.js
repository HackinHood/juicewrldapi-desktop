const { app, BrowserWindow, Menu, ipcMain, dialog, Tray, nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const Store = require('electron-store');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const discordPresence = require('./discordPresence');
const installScope = require('./installScope');

const __originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
let __stdoutEnabled = true;
let __logFilePath;
let __jobLogFilePath;
function __ensureLogFile() {
  if (!__logFilePath) {
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      __logFilePath = path.join(dir, 'main.log');
    } catch (_) {
      __logFilePath = null;
    }
  }
  return __logFilePath;
}
function __ensureJobLogFile() {
  if (!__jobLogFilePath) {
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      __jobLogFilePath = path.join(dir, 'job.log');
    } catch (_) {
      __jobLogFilePath = null;
    }
  }
  return __jobLogFilePath;
}
function __writeToFile(text) {
  try {
    const p = __ensureLogFile();
    if (p) fs.appendFileSync(p, text);
  } catch (_) {}
}
function appendJobLog(line) {
  try {
    const p = __ensureJobLogFile();
    if (!p) return;
    const ts = new Date().toISOString();
    const text = `[${ts}] ${line}${os.EOL}`;
    fs.appendFileSync(p, text);
  } catch (_) {}
}

ipcMain.handle('append-job-log', (event, line) => {
  try {
    if (typeof line !== 'string' || line.length === 0) return { success: false };
    appendJobLog(line);
    return { success: true };
  } catch (_) {
    return { success: false };
  }
});
function __safeConsoleWrite(method, args) {
  const text = (() => {
    try {
      return args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (_) { return String(a); } }).join(' ') + os.EOL;
    } catch (_) { return os.EOL; }
  })();
  if (__stdoutEnabled) {
    try {
      __originalConsole[method](...args);
      return;
    } catch (e) {
      if (e && e.code === 'EPIPE') __stdoutEnabled = false;
    }
    try {
      const stream = (method === 'error' || method === 'warn') ? process.stderr : process.stdout;
      if (stream && typeof stream.write === 'function') { stream.write(text); return; }
    } catch (e) {
      if (e && e.code === 'EPIPE') __stdoutEnabled = false;
    }
  }
  __writeToFile(text);
}
console.log = (...a) => __safeConsoleWrite('log', a);
console.info = (...a) => __safeConsoleWrite('info', a);
console.warn = (...a) => __safeConsoleWrite('warn', a);
console.error = (...a) => __safeConsoleWrite('error', a);
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') return;
  try { __writeToFile(`uncaughtException ${String(err && err.stack || err)}${os.EOL}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  try { __writeToFile(`unhandledRejection ${String(reason && reason.stack || reason)}${os.EOL}`); } catch (_) {}
});

const store = new Store();

function getUserFriendlyError(error, context = '') {
  const errorCode = error.code || '';
  const errorMessage = error.message || '';
  
  const errorMap = {
    'ENOENT': 'File or folder not found',
    'EACCES': 'Permission denied - please check file access rights',
    'ENOSPC': 'Not enough disk space',
    'ECONNREFUSED': 'Connection refused - server may be offline',
    'ENOTFOUND': 'Server not found - check your internet connection',
    'ETIMEDOUT': 'Connection timed out - please try again',
    'ECONNRESET': 'Connection lost - please try again',
    'EADDRINUSE': 'Port already in use - please try a different port',
    'EFAULT': 'Invalid operation - please try again',
    'EINVAL': 'Invalid input - please check your settings',
    'EAGAIN': 'Resource temporarily unavailable - please try again',
    'EBUSY': 'File or folder is busy - please close other applications using it',
    'EEXIST': 'File or folder already exists',
    'EMFILE': 'Too many open files - please close some applications',
    'ENFILE': 'System limit reached - please try again later'
  };
  
  let friendlyMessage = errorMap[errorCode] || 'An unexpected error occurred';
  
  if (context) {
    friendlyMessage = `${context}: ${friendlyMessage}`;
  }
  
  const suggestions = {
    'ENOENT': 'Make sure the file path is correct and the file exists.',
    'EACCES': 'Try running the application as administrator or check file permissions.',
    'ENOSPC': 'Free up some disk space and try again.',
    'ECONNREFUSED': 'Check if the server is running and the URL is correct.',
    'ENOTFOUND': 'Verify your internet connection and server address.',
    'ETIMEDOUT': 'Check your network connection and try again.',
    'ECONNRESET': 'The connection was interrupted. Please try again.',
    'EADDRINUSE': 'The server port is already in use. Try restarting the server.',
    'EFAULT': 'Please restart the application and try again.',
    'EINVAL': 'Please check your settings and try again.',
    'EAGAIN': 'Please wait a moment and try again.',
    'EBUSY': 'Close any applications that might be using the file.',
    'EEXIST': 'Choose a different name or location for the file.',
    'EMFILE': 'Close some applications and try again.',
    'ENFILE': 'Please try again in a few moments.'
  };
  
  const suggestion = suggestions[errorCode];
  if (suggestion) {
    friendlyMessage += ` ${suggestion}`;
  }
  
  return friendlyMessage;
}

function getStoragePath() {
  const customPath = store.get('settings.customStoragePath');
  
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  
  const isSystemWide = installScope.isSystemWideInstall();
  
  if (isSystemWide) {
      const systemPath = process.platform === 'win32' 
        ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'JuiceWRLD-API', 'MP3_Sync')
        : path.join('/var/lib', 'juicewrldapi', 'mp3_sync');
    return systemPath;
  } else {
    return path.join(os.homedir(), 'Documents', 'MP3_Sync');
  }
}

function getDownloadsPath() {
  return path.join(getStoragePath(), 'Downloads');
}

function getMetadataPath() {
  return path.join(getStoragePath(), 'local_metadata.json');
}
function getAudioMetadataCachePath() {
  return path.join(getStoragePath(), 'audio_metadata.json');
}
function getThumbnailsPath() {
  return path.join(getStoragePath(), 'Thumbnails');
}

function isStartWithWindowsEnabled() {
  const isSystemWide = installScope.isSystemWideInstall();
  
  if (isSystemWide && process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const appName = 'JuiceWRLD-API';
      
      const result = execSync(`reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}"`, { stdio: 'pipe' });
      return result.toString().includes(appName);
    } catch (error) {
      return false;
    }
  } else {
    try {
      const loginItemSettings = app.getLoginItemSettings();
      return loginItemSettings.openAtLogin;
    } catch (error) {
      console.error('[Startup] Failed to check user-specific startup status:', error.message);
      return false;
    }
  }
}

function updateStoragePaths() {
  LOCAL_STORAGE_DIR = getStoragePath();
  DOWNLOADS_DIR = getDownloadsPath();
  METADATA_FILE = getMetadataPath();
  
  try {
    if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
      fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
      console.log(`[Storage] Created new storage directory: ${LOCAL_STORAGE_DIR}`);
    }
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      console.log(`[Storage] Created new downloads directory: ${DOWNLOADS_DIR}`);
    }
    const thumbs = getThumbnailsPath();
    if (!fs.existsSync(thumbs)) {
      fs.mkdirSync(thumbs, { recursive: true });
    }
  } catch (error) {
    console.error(`[Storage] Failed to create storage directories: ${error.message}`);
  }
}

function getIconPath() {
  console.log(`[Icon] Resolving icon path for packaged: ${app.isPackaged}, platform: ${process.platform}`);
  console.log(`[Icon] __dirname: ${__dirname}`);
  console.log(`[Icon] process.resourcesPath: ${process.resourcesPath}`);
  
  if (app.isPackaged) {
    let resourcePath;
    if (process.platform === 'win32') {
      resourcePath = path.join(process.resourcesPath, 'icon.ico');
    } else if (process.platform === 'darwin') {
      resourcePath = path.join(process.resourcesPath, 'icon.icns');
    } else {
      resourcePath = path.join(process.resourcesPath, 'icon.png');
    }
    
    console.log(`[Icon] Checking resource path: ${resourcePath}`);
    if (fs.existsSync(resourcePath)) {
      console.log(`[Icon] Using resource icon: ${resourcePath}`);
      return resourcePath;
    }
    
    let buildPath;
    if (process.platform === 'win32') {
      buildPath = path.join(__dirname, 'build/icon.ico');
    } else if (process.platform === 'darwin') {
      buildPath = path.join(__dirname, 'build/icon.icns');
    } else {
      buildPath = path.join(__dirname, 'build/icon.png');
    }
    
    console.log(`[Icon] Checking build path: ${buildPath}`);
    if (fs.existsSync(buildPath)) {
      console.log(`[Icon] Using build icon: ${buildPath}`);
      return buildPath;
    }
    
    if (process.platform === 'win32') {
      const parentIconPath = path.join(__dirname, '..', 'build', 'icon.ico');
      console.log(`[Icon] Checking parent build path: ${parentIconPath}`);
      if (fs.existsSync(parentIconPath)) {
        console.log(`[Icon] Using parent build icon: ${parentIconPath}`);
        return parentIconPath;
      }
    }
  }
  
  let devPath;
  if (process.platform === 'win32') {
    devPath = path.join(__dirname, 'build/icon.ico');
  } else if (process.platform === 'darwin') {
    devPath = path.join(__dirname, 'build/icon.icns');
  } else {
    devPath = path.join(__dirname, 'build/icon.png');
  }
  
  console.log(`[Icon] Checking dev path: ${devPath}`);
  if (fs.existsSync(devPath)) {
    console.log(`[Icon] Using dev icon: ${devPath}`);
    return devPath;
  }
  
  const possiblePaths = [
    path.join(__dirname, 'build/icon.ico'),
    path.join(__dirname, 'build/icon.icns'),
    path.join(__dirname, 'build/icon.png'),
    path.join(__dirname, 'assets/icon.png'),
    path.join(__dirname, 'assets/icon_128x128.png')
  ];
  
  console.log(`[Icon] Checking fallback paths:`, possiblePaths);
  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      console.log(`[Icon] Using fallback icon: ${iconPath}`);
      return iconPath;
    }
  }
  
  console.warn('[Icon] No icon file found, using default');
  return null;
}

function getTrayIconPath() {
  console.log(`[Tray Icon] Resolving tray icon path for platform: ${process.platform}`);
  
  if (process.platform === 'win32') {
    const trayIconPaths = [
      path.join(__dirname, 'assets/icon_16x16.png'),
      path.join(__dirname, 'assets/icon_32x32.png'),
      path.join(__dirname, 'assets/icon_48x48.png'),
      path.join(__dirname, 'assets/icon_64x64.png')
    ];
    
    for (const iconPath of trayIconPaths) {
      if (fs.existsSync(iconPath)) {
        console.log(`[Tray Icon] Using tray-optimized icon: ${iconPath}`);
        return iconPath;
      }
    }
    
    console.log(`[Tray Icon] Falling back to main icon path`);
    return getIconPath();
  }

  if (process.platform === 'darwin') {
    const trayIconPaths = [
      path.join(__dirname, 'assets/icon_22x22.png'),
      path.join(__dirname, 'assets/icon_16x16.png'),
      path.join(__dirname, 'assets/icon_32x32.png'),
      path.join(__dirname, 'assets/icon_48x48.png')
    ];

    for (const iconPath of trayIconPaths) {
      if (fs.existsSync(iconPath)) {
        console.log(`[Tray Icon] Using mac tray icon candidate: ${iconPath}`);
        return iconPath;
      }
    }
    return getIconPath();
  }

  return getIconPath();
}

function createOptimizedTrayIcon() {
  try {
    const iconPath = getTrayIconPath();
    if (!iconPath) {
      console.error('[Tray Icon] No icon path available');
      return null;
    }
    
    const icon = nativeImage.createFromPath(iconPath);
    
    if (process.platform === 'win32') {
      const iconSize = icon.getSize();
      console.log(`[Tray Icon] Original icon size: ${iconSize.width}x${iconSize.height}`);
      
      if (iconSize.width === 16 && iconSize.height === 16) {
        console.log('[Tray Icon] Using 16x16 icon directly');
        return icon;
      }
      
      const trayIcon = icon.resize({ 
        width: 16, 
        height: 16,
        quality: 'best'
      });
      
      console.log('[Tray Icon] Created optimized 16x16 tray icon');
      return trayIcon;
    }

    if (process.platform === 'darwin') {
      const size = icon.getSize();
      console.log(`[Tray Icon] Original mac icon size: ${size.width}x${size.height}`);
      const target = 22;
      const trayIcon = icon.resize({ width: target, height: target, quality: 'best' });
      try { trayIcon.setTemplateImage(true); } catch (_) {}
      console.log('[Tray Icon] Created mac template tray icon');
      return trayIcon;
    }

    return icon;
  } catch (error) {
    console.error('[Tray Icon] Failed to create optimized tray icon:', error.message);
    return null;
  }
}

let LOCAL_STORAGE_DIR = getStoragePath();
let DOWNLOADS_DIR = getDownloadsPath();
let METADATA_FILE = getMetadataPath();

let mainWindow;
let tray = null;
let fileStatsCache = new Map();
let bgSyncWorker = null;
let syncWindow = null;
let activeTransfers = new Map();
let metadataWriteQueue = Promise.resolve();

function startBackgroundSyncWorker() {
  try {
    if (bgSyncWorker) return
    const settings = store.get('settings', { autoSyncEnabled: true, autoSyncInterval: 30 })
    const intervalMs = Math.max(60000, (parseInt(settings.autoSyncInterval)||30) * 60000)
    bgSyncWorker = new Worker(path.join(__dirname, 'backgroundSyncWorker.js'), { workerData: { intervalMs } })
    bgSyncWorker.on('message', async (msg) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'run-sync') {
        try {
          const wins = BrowserWindow.getAllWindows()
          for (const win of wins) {
            try { win.webContents.send('menu-new-sync') } catch (_) {}
          }
        } catch (_) {}
      } else if (msg.type === 'sync-complete') {
        try {
          const wins = BrowserWindow.getAllWindows()
          for (const win of wins) {
            try { win.webContents.send('library-updated') } catch (_) {}
          }
        } catch (_) {}
      }
    })
    bgSyncWorker.on('error', () => {})
    bgSyncWorker.on('exit', () => { bgSyncWorker = null })
  } catch (_) {}
}

function ensureSyncWindow() {
  try {
    if (syncWindow) return
    syncWindow = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      backgroundColor: '#111214',
      webPreferences: {
        devTools: false,
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload.js')
      }
    })
    syncWindow.loadFile('index.html')
    syncWindow.on('closed', () => { syncWindow = null })
  } catch (_) {}
}

function destroySyncWindow() {
  try {
    if (!syncWindow) return
    const win = syncWindow
    syncWindow = null
    try { win.close() } catch (_) {}
  } catch (_) {}
}

function createWindow() {
  const settings = store.get('settings', {
    windowWidth: 1100,
    windowHeight: 750,
    windowX: undefined,
    windowY: undefined
  });
  
  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    x: settings.windowX,
    y: settings.windowY,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      devTools: false,
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getIconPath(),
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: process.platform === 'darwin',
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    titleBarOverlay: process.platform === 'win32' ? { color: '#111214', symbolColor: '#ffffff', height: 36 } : undefined,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    titleBarOverlay: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  
  
  mainWindow.on('close', (event) => {
    const settings = store.get('settings', { minimizeToTray: false });
    if (!app.isQuiting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      
      const settings = store.get('settings', { showTrayNotifications: true });
      if (tray && settings.showTrayNotifications) {
        if (process.platform === 'win32' && typeof tray.displayBalloon === 'function') {
          tray.displayBalloon({
            title: 'JuiceWRLD API',
            content: 'App minimized to system tray. Click the tray icon to restore.',
            icon: getTrayIconPath()
          });
        }
      }
    }
    
    try {
      const bounds = mainWindow.getBounds();
      const currentSettings = store.get('settings', {});
      currentSettings.windowWidth = bounds.width;
      currentSettings.windowHeight = bounds.height;
      currentSettings.windowX = bounds.x;
      currentSettings.windowY = bounds.y;
      store.set('settings', currentSettings);
      console.log('[Settings] Window position and size saved:', bounds);
    } catch (error) {
      console.error('[Settings] Failed to save window position and size:', error.message);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Sync',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const wins = BrowserWindow.getAllWindows();
            for (const win of wins) {
              try { win.webContents.send('menu-new-sync') } catch (_) {}
            }
          }
        },
        {
          label: 'Open Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('menu-open-settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            const settings = store.get('settings', { minimizeToTray: false });
            if (settings.minimizeToTray) {
              mainWindow.hide();
            } else {
              mainWindow.webContents.send('show-message', {
                type: 'info',
                title: 'Minimize to Tray',
                message: 'Please enable "Minimize to Tray" in settings first.'
              });
            }
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    }
    ,
    {
      label: 'Player',
      submenu: [
        {
          label: 'Open Player Mode',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) {
              ensureSyncWindow();
              mainWindow.loadFile('player.html');
            }
          }
        },
        {
          label: 'Return to Main App',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            if (mainWindow) {
              mainWindow.loadFile('index.html');
              destroySyncWindow();
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  try { mainWindow.setMenuBarVisibility(false); } catch (_) {}
}

function createTray() {
  try {
    const icon = createOptimizedTrayIcon();
    
    if (!icon) {
      console.error('[Tray] No optimized icon available, cannot create system tray');
      return;
    }
    
    tray = new Tray(icon);
    console.log('[Tray] System tray created successfully with optimized icon');
  } catch (error) {
    console.error('[Tray] Failed to create system tray:', error.message);
    return;
  }
  tray.setToolTip('JuiceWRLD API');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'New Sync',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          const wins = BrowserWindow.getAllWindows();
          for (const win of wins) {
            try { win.webContents.send('menu-new-sync') } catch (_) {}
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('menu-open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    try { tray.popUpContextMenu(); } catch (_) {}
  });
}

function updateTrayTooltip(status = 'Ready') {
  if (tray) {
            tray.setToolTip(`JuiceWRLD API - ${status}`);
  }
}

function updateTrayVisibility() {
  const settings = store.get('settings', { minimizeToTray: false });
  if (tray) {
    if (settings.minimizeToTray) {
              tray.setToolTip('JuiceWRLD API - Ready');
    } else {
              tray.setToolTip('JuiceWRLD API - Minimize to tray disabled');
    }
  }
}

function initializeLocalStorage() {
  try {
    const storagePath = getStoragePath();
    const downloadsPath = getDownloadsPath();
    const metadataPath = getMetadataPath();
    
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
      console.log(`[Storage] Created local storage directory: ${storagePath}`);
    }
    
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
      console.log(`[Storage] Created downloads directory: ${downloadsPath}`);
    }
    
    if (!fs.existsSync(metadataPath)) {
      const initialMetadata = {
        files: {},
        lastSync: null,
        syncCount: 0,
        totalSize: 0,
        version: '1.0'
      };
      fs.writeFileSync(metadataPath, JSON.stringify(initialMetadata, null, 2));
      console.log(`[Storage] Created metadata file: ${metadataPath}`);
    }
    const audioMetaCachePath = getAudioMetadataCachePath();
    if (!fs.existsSync(audioMetaCachePath)) {
      fs.writeFileSync(audioMetaCachePath, '{}');
      console.log(`[Storage] Created audio metadata cache: ${audioMetaCachePath}`);
    }
    const thumbs = getThumbnailsPath();
    if (!fs.existsSync(thumbs)) {
      fs.mkdirSync(thumbs, { recursive: true });
    }
    
    console.log(`[Storage] Local storage initialized successfully`);
    return true;
  } catch (error) {
    console.error(`[Storage] Failed to initialize local storage: ${error.message}`);
    return false;
  }
}

function loadLocalMetadata() {
  try {
    const metadataPath = getMetadataPath();
    console.log(`[Storage] loadLocalMetadata called, checking file: ${metadataPath}`);
    console.log(`[Storage] File exists: ${fs.existsSync(metadataPath)}`);
    
    if (fs.existsSync(metadataPath)) {
      const data = fs.readFileSync(metadataPath, 'utf8');
      console.log(`[Storage] File content length: ${data.length} characters`);
      console.log(`[Storage] File content preview: ${data.substring(0, 200)}...`);
      
      const parsed = JSON.parse(data);
      console.log(`[Storage] Parsed metadata:`, parsed);
      return parsed;
    } else {
      console.log(`[Storage] Metadata file does not exist, returning default`);
    }
  } catch (error) {
    console.error(`[Storage] Failed to load metadata: ${error.message}`);
    console.error(`[Storage] Error stack:`, error.stack);
  }
  return { files: {}, lastSync: null, syncCount: 0, totalSize: 0, version: '1.0' };
}

function saveLocalMetadata(metadata) {
  try {
    const metadataPath = getMetadataPath();
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    return true;
  } catch (error) {
    console.error(`[Storage] Failed to save metadata: ${error.message}`);
    return false;
  }
}

function loadAudioMetadataCache() {
  try {
    const p = getAudioMetadataCachePath();
    if (!fs.existsSync(p)) return {};
    const txt = fs.readFileSync(p, 'utf8');
    return JSON.parse(txt || '{}');
  } catch (_) {
    return {};
  }
}

function saveAudioMetadataCache(cache) {
  try {
    const p = getAudioMetadataCachePath();
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

function getThumbnailCacheFile(localPath, mtimeMs, mimeOrExt) {
  try {
    const crypto = require('crypto');
    const key = `${localPath}:${mtimeMs || 'na'}`;
    const name = crypto.createHash('md5').update(key).digest('hex');
    const ext = (typeof mimeOrExt === 'string' && mimeOrExt.startsWith('.'))
      ? mimeOrExt
      : (String(mimeOrExt || '').toLowerCase().includes('png') ? '.png' : '.jpg');
    const dir = getThumbnailsPath();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name + ext);
  } catch (_) {
    return null;
  }
}

function saveThumbnailFromDataUrl(localPath, mtimeMs, dataUrl) {
  try {
    if (typeof dataUrl !== 'string') return false;
    const m = dataUrl.match(/^data:(.*?);base64,(.+)$/);
    if (!m) return false;
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const buf = Buffer.from(b64, 'base64');
    const target = getThumbnailCacheFile(localPath, mtimeMs, mime);
    if (!target) return false;
    fs.writeFileSync(target, buf);
    return true;
  } catch (_) { return false; }
}

function saveThumbnailFromImageFile(localPath, mtimeMs, imagePath) {
  try {
    if (!fs.existsSync(imagePath)) return false;
    const ext = path.extname(imagePath).toLowerCase();
    const target = getThumbnailCacheFile(localPath, mtimeMs, ext || '.jpg');
    if (!target) return false;
    fs.copyFileSync(imagePath, target);
    return true;
  } catch (_) { return false; }
}

function tryGenerateAudioThumbnail(localPath, mtimeMs, tags) {
  try {
    if (tags && typeof tags.albumArt === 'string') {
      if (saveThumbnailFromDataUrl(localPath, mtimeMs, tags.albumArt)) return true;
    }
    const dir = path.dirname(localPath);
    const preferred = ['cover', 'folder', 'front', 'album'];
    const exts = ['.jpg', '.jpeg', '.png'];
    for (const base of preferred) {
      for (const ext of exts) {
        const p = path.join(dir, base + ext);
        if (fs.existsSync(p)) return saveThumbnailFromImageFile(localPath, mtimeMs, p);
      }
    }
    try {
      const files = fs.readdirSync(dir).filter(f => exts.includes(path.extname(f).toLowerCase()));
      if (files && files.length > 0) {
        const p = path.join(dir, files[0]);
        return saveThumbnailFromImageFile(localPath, mtimeMs, p);
      }
    } catch (_) {}
    return false;
  } catch (_) { return false; }
}

function resolveBundledFfmpegPath() {
  try {
    try {
      const ff = require('ffmpeg-static');
      if (ff && typeof ff === 'string' && fs.existsSync(ff)) return ff;
    } catch (_) {}
    const candidates = [];
    const res = process.resourcesPath || __dirname;
    if (process.platform === 'win32') {
      candidates.push(path.join(res, 'ffmpeg.exe'));
      candidates.push(path.join(res, 'bin', 'ffmpeg.exe'));
      candidates.push(path.join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'));
      candidates.push(path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'));
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      candidates.push(path.join(res, 'ffmpeg'));
      candidates.push(path.join(res, 'bin', 'ffmpeg'));
      candidates.push(path.join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'));
      candidates.push(path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg'));
    }
    for (const c of candidates) { if (fs.existsSync(c)) return c; }
  } catch (_) {}
  return null;
}

function isFfmpegAvailable() {
  try {
    const cp = require('child_process');
    const bundled = resolveBundledFfmpegPath();
    if (bundled) {
      const out = cp.spawnSync(bundled, ['-version'], { stdio: 'ignore' });
      if (out && out.status === 0) return true;
    }
    const out = cp.spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return out && out.status === 0;
  } catch (_) { return false; }
}

async function tryGenerateVideoThumbnail(localPath, mtimeMs) {
  try {
    if (!isFfmpegAvailable()) return false;
    const { spawn } = require('child_process');
    const ffmpegBin = resolveBundledFfmpegPath() || 'ffmpeg';
    const target = getThumbnailCacheFile(localPath, mtimeMs, '.jpg');
    if (!target) return false;
    const args = ['-y', '-ss', '00:00:01', '-i', localPath, '-frames:v', '1', '-vf', 'scale=320:-1', target];
    return await new Promise((resolve) => {
      try {
        const p = spawn(ffmpegBin, args, { windowsHide: true });
        p.on('error', () => resolve(false));
        p.on('exit', (code) => resolve(code === 0 && fs.existsSync(target)));
      } catch (_) { resolve(false); }
    });
  } catch (_) { return false; }
}

function resolveSafeDownloadsPath(relativePath) {
  const base = path.resolve(getDownloadsPath());
  const target = path.resolve(base, String(relativePath || ''));
  if (!target.startsWith(base + path.sep)) {
    throw new Error('Invalid path');
  }
  return target;
}

function isSafeText(value, maxLength) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (/[\0\r\n]/.test(value)) return false;
  return true;
}

function computeFileHash(filePath, algorithm) {
  return new Promise((resolve, reject) => {
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash(algorithm || 'md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(hash.digest('hex')));
    } catch (e) {
      reject(e);
    }
  });
}

const MAX_API_BODY = 10485760;
const MAX_DOWNLOAD_BYTES = Number.MAX_SAFE_INTEGER;

function isFileLocal(filepath) {
  try {
    const metadata = loadLocalMetadata();
    const fullPath = resolveSafeDownloadsPath(filepath);
    return Boolean(metadata.files[filepath]) && fs.existsSync(fullPath);
  } catch (e) {
    return false;
  }
}

function getLocalFilePath(filepath) {
  return resolveSafeDownloadsPath(filepath);
}

function getLocalStorageInfo() {
  try {
    const metadata = loadLocalMetadata();
    const storagePath = getStoragePath();
    const stats = fs.statSync(storagePath);
    
    return {
      localPath: storagePath,
      downloadsPath: getDownloadsPath(),
      totalFiles: Object.keys(metadata.files).length,
      totalSize: metadata.totalSize,
      lastSync: metadata.lastSync,
      diskUsage: stats.size,
      freeSpace: os.freemem()
    };
  } catch (error) {
    console.error(`[Storage] Failed to get storage info: ${error.message}`);
    return null;
  }
}

function applyStartupSettings() {
  try {
    const settings = store.get('settings', {
      startWithWindows: false,
      minimizeToTray: false,
      showTrayNotifications: true,
      autoSyncEnabled: true,
      autoSyncInterval: 30,
      maxTransfers: 3,
      logLevel: 'info',
      serverUrl: 'https://m.juicewrldapi.com',
      windowWidth: 1100,
      windowHeight: 750,
      windowX: undefined,
      windowY: undefined,
      selectedFolders: [],
      customStoragePath: undefined,
      lastActiveTab: 'overview',
      discordRpcEnabled: true,
      discordRpcClientId: '1401436107765452860'
    });
    
    console.log('[Settings] Applying startup settings:', settings);
    try {
      discordPresence.setEnabled(Boolean(settings.discordRpcEnabled))
      if (settings.discordRpcEnabled && settings.discordRpcClientId) {
        discordPresence.init(String(settings.discordRpcClientId))
      }
    } catch (_) {}
    
    if (settings.startWithWindows) {
      const isSystemWide = installScope.isSystemWideInstall();
      
      if (isSystemWide && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const exePath = process.execPath;
          const appName = 'JuiceWRLD-API';
          
          let isAdmin = false;
          try {
            require('child_process').execSync('net session', { stdio: 'pipe' });
            isAdmin = true;
          } catch (error) {
            isAdmin = false;
          }
          
          if (isAdmin) {
            execSync(`reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /t REG_SZ /d "${exePath}" /f`, { stdio: 'pipe' });
            console.log('[Settings] Set to start with Windows (system-wide)');
          } else {
            console.log('[Settings] System-wide startup requires administrator privileges');
            app.setLoginItemSettings({
              openAtLogin: true,
              openAsHidden: true
            });
            console.log('[Settings] Fallback to user-specific startup method (admin privileges required for system-wide)');
          }
        } catch (error) {
          console.error('[Settings] Failed to set system-wide startup:', error.message);
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true
          });
          console.log('[Settings] Fallback to user-specific startup method');
        }
      } else {
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true
        });
        console.log('[Settings] Set to start with Windows (user-specific)');
      }
    } else {
      const isSystemWide = installScope.isSystemWideInstall();
      
      if (isSystemWide && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const appName = 'JuiceWRLD-API';
          
          execSync(`reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /f`, { stdio: 'pipe' });
          console.log('[Settings] Disabled start with Windows (system-wide)');
        } catch (error) {
          console.error('[Settings] Failed to remove system-wide startup:', error.message);
          app.setLoginItemSettings({
            openAtLogin: false
          });
          console.log('[Settings] Fallback to user-specific startup removal');
        }
      } else {
        app.setLoginItemSettings({
          openAtLogin: false
        });
        console.log('[Settings] Disabled start with Windows (user-specific)');
      }
    }
    
    
    console.log('[Settings] Startup settings applied successfully');
  } catch (error) {
    console.error('[Settings] Failed to apply startup settings:', error.message);
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.juicewrldapi.desktop');
  }
  
  updateStoragePaths();
  
  if (initializeLocalStorage()) {
    console.log('[App] Local storage initialized successfully');
  } else {
    console.error('[App] Failed to initialize local storage');
  }
  
  try { store.delete('playbackState'); } catch (_) {}
  
  applyStartupSettings();
  
  createWindow();
  createTray();
  startBackgroundSyncWorker();

  ipcMain.handle('discord-rpc-init', (_e, clientId) => {
    try { return discordPresence.init(clientId) } catch (_) { return false }
  })
  ipcMain.handle('discord-rpc-update', (_e, payload) => {
    try { return discordPresence.updatePresence(payload) } catch (_) { return false }
  })
  ipcMain.handle('discord-rpc-clear', () => {
    try { return discordPresence.clear() } catch (_) { return false }
  })
  ipcMain.handle('discord-rpc-enabled', (_e, enabled) => {
    try { discordPresence.setEnabled(Boolean(enabled)); return true } catch (_) { return false }
  })
  ipcMain.handle('discord-rpc-status', () => {
    try { return discordPresence.getStatus() } catch (_) { return { enabled:false, connected:false } }
  })
  ipcMain.handle('get-active-transfers', () => {
    try { return Array.from(activeTransfers.values()) } catch (_) { return [] }
  })
  
  const iconPath = getIconPath();
  if (iconPath) {
    app.setAppUserModelId('com.juicewrldapi.desktop');
    
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.juicewrldapi.desktop');
    }
    
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(iconPath);
    }
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  
  if (tray) {
    tray.destroy();
    tray = null;
  }
  try { if (bgSyncWorker) { bgSyncWorker.terminate(); bgSyncWorker = null; } } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle('open-player-mode', () => {
  try {
    if (mainWindow) {
      try { ensureSyncWindow() } catch (_) {}
      mainWindow.loadFile('player.html');
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('open-main-ui', () => {
  try {
    if (mainWindow) {
      mainWindow.loadFile('index.html');
      try { destroySyncWindow() } catch (_) {}
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('save-playback-state', (event, state) => {
  try {
    store.set('playbackState', state || null);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

ipcMain.handle('get-playback-state', () => {
  try {
    const state = store.get('playbackState', null);
    return { success: true, state };
  } catch (e) {
    return { success: false, state: null };
  }
});

ipcMain.handle('clear-playback-state', () => {
  try {
    store.delete('playbackState');
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});
ipcMain.handle('get-settings', () => {
  return store.get('settings', {
    startWithWindows: false,
    minimizeToTray: false,
    showTrayNotifications: true,
    autoSyncEnabled: true,
    autoSyncInterval: 30,
    maxTransfers: 3,
    logLevel: 'info',
    serverUrl: 'https://m.juicewrldapi.com',
    windowWidth: 1200,
    windowHeight: 800,
    windowX: undefined,
    windowY: undefined,
    selectedFolders: [],
    customStoragePath: undefined,
    lastActiveTab: 'overview'
  });
});

ipcMain.handle('save-settings', (event, settings) => {
  const existingSettings = store.get('settings', {});
  const validatedSettings = {
    startWithWindows: Boolean(settings.startWithWindows),
    minimizeToTray: Boolean(settings.minimizeToTray),
    showTrayNotifications: Boolean(settings.showTrayNotifications),
    autoSyncEnabled: Boolean(settings.autoSyncEnabled),
    autoSyncInterval: Math.max(0, Math.min(1440, parseInt(settings.autoSyncInterval) || 30)),
    maxTransfers: Math.max(1, Math.min(10, parseInt(settings.maxTransfers) || 3)),
    logLevel: ['debug', 'info', 'warning', 'error'].includes(settings.logLevel) ? settings.logLevel : 'info',
    serverUrl: typeof settings.serverUrl === 'string' && settings.serverUrl.trim() ? settings.serverUrl.trim() : 'https://m.juicewrldapi.com',
    windowWidth: Math.max(900, Math.min(3000, parseInt(settings.windowWidth) || 1100)),
    windowHeight: Math.max(600, Math.min(2000, parseInt(settings.windowHeight) || 750)),
    windowX: typeof settings.windowX === 'number' && !isNaN(settings.windowX) ? settings.windowX : undefined,
    windowY: typeof settings.windowY === 'number' && !isNaN(settings.windowY) ? settings.windowY : undefined,
    selectedFolders: Array.isArray(settings.selectedFolders) ? settings.selectedFolders : [],
    customStoragePath: typeof settings.customStoragePath === 'string' ? settings.customStoragePath : undefined,
    lastActiveTab: ['overview', 'local-files', 'server-files', 'sync', 'settings', 'account'].includes(settings.lastActiveTab) ? settings.lastActiveTab : 'overview',
    authData: settings.authData && typeof settings.authData === 'object' ? settings.authData : undefined
  };

  const sanitized = Object.fromEntries(Object.entries(validatedSettings).filter(([_, v]) => v !== undefined));
  const mergedSettings = { ...existingSettings, ...sanitized };
  store.set('settings', mergedSettings);
  
  try {
    if (validatedSettings.startWithWindows !== undefined) {
      const isSystemWide = app.isPackaged && !app.getPath('userData').includes(os.homedir());
      
      if (isSystemWide && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const exePath = process.execPath;
          const appName = 'JuiceWRLD-API';
          
          let isAdmin = false;
          try {
            execSync('net session', { stdio: 'pipe' });
            isAdmin = true;
          } catch (error) {
            isAdmin = false;
          }
          
          if (isAdmin) {
            if (validatedSettings.startWithWindows) {
              execSync(`reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /t REG_SZ /d "${exePath}" /f`, { stdio: 'pipe' });
              console.log('[Settings] Start with Windows enabled (system-wide)');
            } else {
              execSync(`reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /f`, { stdio: 'pipe' });
              console.log('[Settings] Start with Windows disabled (system-wide)');
            }
          } else {
            console.log('[Settings] System-wide startup requires administrator privileges');
            app.setLoginItemSettings({
              openAtLogin: validatedSettings.startWithWindows,
              openAsHidden: validatedSettings.startWithWindows
            });
            console.log(`[Settings] Fallback to user-specific startup method (admin privileges required for system-wide): ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'}`);
          }
        } catch (error) {
          console.error('[Settings] Failed to set system-wide startup:', error.message);
          app.setLoginItemSettings({
            openAtLogin: validatedSettings.startWithWindows,
            openAsHidden: validatedSettings.startWithWindows
          });
          console.log(`[Settings] Fallback to user-specific startup method: ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'}`);
        }
      } else {
        app.setLoginItemSettings({
          openAtLogin: validatedSettings.startWithWindows,
          openAsHidden: validatedSettings.startWithWindows
        });
        console.log(`[Settings] Start with Windows ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'} (user-specific)`);
      }
    }
    
    if (validatedSettings.minimizeToTray !== undefined) {
      updateTrayVisibility();
      console.log(`[Settings] Tray visibility updated (minimizeToTray: ${validatedSettings.minimizeToTray})`);
    }
    
    console.log('[Settings] Settings saved and applied successfully');
    try {
      if (bgSyncWorker) {
        const intervalMs = Math.max(60000, (parseInt(validatedSettings.autoSyncInterval)||30) * 60000)
        bgSyncWorker.postMessage({ type: 'update-settings', intervalMs })
      }
    } catch (_) {}
  } catch (error) {
    console.error('[Settings] Failed to apply settings immediately:', error.message);
  }
  
  return true;
});

ipcMain.handle('export-settings', async (event) => {
  try {
    const settings = store.get('settings', {});
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      settings: settings
    };
    
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Settings',
      defaultPath: path.join(os.homedir(), 'juicewrld-api-settings.json'),
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
      console.log('[Settings] Settings exported successfully to:', result.filePath);
      return { success: true, filePath: result.filePath };
    }
    
    return { success: false, canceled: true };
  } catch (error) {
    console.error('[Settings] Failed to export settings:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-settings', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Settings',
      defaultPath: os.homedir(),
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const importData = JSON.parse(fileContent);
      
      if (importData.settings && typeof importData.settings === 'object') {
         const validatedSettings = {
           startWithWindows: Boolean(importData.settings.startWithWindows),
           minimizeToTray: Boolean(importData.settings.minimizeToTray),
           showTrayNotifications: Boolean(importData.settings.showTrayNotifications),
           autoSyncEnabled: Boolean(importData.settings.autoSyncEnabled),
           autoSyncInterval: Math.max(0, Math.min(1440, parseInt(importData.settings.autoSyncInterval) || 30)),
           maxTransfers: Math.max(1, Math.min(10, parseInt(importData.settings.maxTransfers) || 3)),
           logLevel: ['debug', 'info', 'warning', 'error'].includes(importData.settings.logLevel) ? importData.settings.logLevel : 'info',
           serverUrl: typeof importData.settings.serverUrl === 'string' && importData.settings.serverUrl.trim() ? importData.settings.serverUrl.trim() : 'https://m.juicewrldapi.com',
           windowWidth: Math.max(1200, Math.min(3000, parseInt(importData.settings.windowWidth) || 1200)),
           windowHeight: Math.max(800, Math.min(2000, parseInt(importData.settings.windowHeight) || 800)),
           windowX: typeof importData.settings.windowX === 'number' && !isNaN(importData.settings.windowX) ? importData.settings.windowX : undefined,
           windowY: typeof importData.settings.windowY === 'number' && !isNaN(importData.settings.windowY) ? importData.settings.windowY : undefined,
           selectedFolders: Array.isArray(importData.settings.selectedFolders) ? importData.settings.selectedFolders : [],
           customStoragePath: typeof importData.settings.customStoragePath === 'string' ? importData.settings.customStoragePath : undefined,
           lastActiveTab: ['overview', 'local-files', 'server-files', 'sync', 'settings', 'account'].includes(importData.settings.lastActiveTab) ? importData.settings.lastActiveTab : 'overview',
           authData: importData.settings.authData && typeof importData.settings.authData === 'object' ? importData.settings.authData : undefined
         };
        
        store.set('settings', validatedSettings);
        console.log('[Settings] Settings imported successfully from:', filePath);
        
        try {
          if (validatedSettings.startWithWindows !== undefined) {
            const isSystemWide = app.isPackaged && !app.getPath('userData').includes(os.homedir());
            
            if (isSystemWide && process.platform === 'win32') {
              try {
                const { execSync } = require('child_process');
                const exePath = process.execPath;
                const appName = 'JuiceWRLD-API';
                
                let isAdmin = false;
                try {
                  execSync('net session', { stdio: 'pipe' });
                  isAdmin = true;
                } catch (error) {
                  isAdmin = false;
                }
                
                if (isAdmin) {
                  if (validatedSettings.startWithWindows) {
                    execSync(`reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /t REG_SZ /d "${exePath}" /f`, { stdio: 'pipe' });
                    console.log('[Settings] Imported: Start with Windows enabled (system-wide)');
                  } else {
                    execSync(`reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /f`, { stdio: 'pipe' });
                    console.log('[Settings] Imported: Start with Windows disabled (system-wide)');
                  }
                } else {
                  console.log('[Settings] Imported: System-wide startup requires administrator privileges');
                  app.setLoginItemSettings({
                    openAtLogin: validatedSettings.startWithWindows,
                    openAsHidden: validatedSettings.startWithWindows
                  });
                  console.log(`[Settings] Imported: Fallback to user-specific startup method (admin privileges required for system-wide): ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'}`);
                }
              } catch (error) {
                console.error('[Settings] Failed to set system-wide startup from import:', error.message);
                app.setLoginItemSettings({
                  openAtLogin: validatedSettings.startWithWindows,
                  openAsHidden: validatedSettings.startWithWindows
                });
                console.log(`[Settings] Imported: Fallback to user-specific startup method: ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'}`);
              }
            } else {
              app.setLoginItemSettings({
                openAtLogin: validatedSettings.startWithWindows,
                openAsHidden: validatedSettings.startWithWindows
              });
              console.log(`[Settings] Imported: Start with Windows ${validatedSettings.startWithWindows ? 'enabled' : 'disabled'} (user-specific)`);
            }
          }
          updateTrayVisibility();
        } catch (error) {
          console.error('[Settings] Failed to apply imported settings:', error.message);
        }
        
        return { success: true, settings: validatedSettings };
      } else {
        return { success: false, error: 'Invalid settings file format' };
      }
    }
    
    return { success: false, canceled: true };
  } catch (error) {
    console.error('[Settings] Failed to import settings:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-tray-tooltip', (event, status) => {
  updateTrayTooltip(status);
  return true;
});

ipcMain.handle('update-tray-visibility', () => {
  updateTrayVisibility();
  return true;
});

ipcMain.handle('get-startup-status', () => {
  try {
    const isEnabled = isStartWithWindowsEnabled();
    const isSystemWide = installScope.isSystemWideInstall();
    
    return {
      startWithWindows: isEnabled,
      isSystemWide: isSystemWide,
      platform: process.platform
    };
  } catch (error) {
    console.error('[Startup] Failed to get startup status:', error.message);
    return {
      startWithWindows: false,
      isSystemWide: false,
      platform: process.platform,
      error: error.message
    };
  }
});

ipcMain.handle('get-install-scope', () => {
  try {
    const d = installScope.detectScope();
    return { scope: d.scope, platform: d.platform };
  } catch (_) {
    return { scope: 'unknown', platform: process.platform };
  }
});

ipcMain.handle('select-folder', async () => {
  try {
    console.log('[Storage] Opening folder selection dialog...');
    console.log('[Storage] mainWindow exists:', !!mainWindow);
    
    if (!mainWindow) {
      console.error('[Storage] mainWindow is not available');
      return null;
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Storage Folder',
      properties: ['openDirectory'],
      buttonLabel: 'Select Folder'
    });
    
    console.log('[Storage] Folder selection result:', result);
    
    if (result.canceled) {
      console.log('[Storage] User canceled folder selection');
      return null;
    }
    
    if (result.filePaths && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      console.log('[Storage] User selected folder:', selectedPath);
      return selectedPath;
    }
    
    console.log('[Storage] No folder selected');
    return null;
  } catch (error) {
    console.error('[Storage] Error in folder selection:', error.message);
    throw error;
  }
});

ipcMain.handle('show-message', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result.response;
});

ipcMain.handle('api-get', async (event, endpoint, params = {}) => {
  try {
    const settings = store.get('settings', { serverUrl: 'https://m.juicewrldapi.com' });
    const serverUrl = settings.serverUrl || 'https://m.juicewrldapi.com';
    if (!isSafeText(String(endpoint || ''), 1024)) {
      return { error: 'Invalid endpoint' };
    }
    const url = new URL(endpoint, serverUrl);

    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (!isSafeText(String(key), 256)) continue;
        const v = String(value);
        if (!isSafeText(v, 2048)) continue;
        url.searchParams.append(key, v);
      }
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'Unsupported protocol' };
    }

    return new Promise((resolve) => {
      try {
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const options = {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Host': url.host,
            'User-Agent': 'JuiceWRLD-API-Desktop/1.0.0',
            'Accept': 'application/json, text/plain, */*',
            'Connection': 'close'
          },
          timeout: 10000
        };

        console.log('[HTTP] Request options:', JSON.stringify(options, null, 2));
        console.log('[HTTP] Full URL:', url.toString());

        const request = lib.request(options, (response) => {
        console.log('[HTTP] Response status:', response.statusCode);
        console.log('[HTTP] Response headers:', response.headers);
        
        let data = '';
        let received = 0;

        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_API_BODY) {
            request.destroy();
            resolve({ error: 'Response too large' });
            return;
          }
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode >= 400) {
            resolve({ error: `HTTP ${response.statusCode}: ${response.statusMessage || 'Request failed'}` });
            return;
          }

          try {
            if (String(data).trim() === '') {
              resolve({ error: 'Empty response from server' });
              return;
            }
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            resolve({ error: 'Invalid response format' });
          }
        });
        });

        request.on('error', () => {
          resolve({ error: 'Network error. Please try again.' });
        });

        request.setTimeout(10000, () => {
          try { request.destroy(); } catch (_) {}
          resolve({ error: 'Request timed out' });
        });

        request.end();
      } catch (err) {
        resolve({ error: 'Request setup failed' });
      }
    });
  } catch (error) {
    return { error: 'Unexpected error' };
  }
});

ipcMain.handle('api-post', async (event, endpoint, data = {}) => {
  try {
    const settings = store.get('settings', { serverUrl: 'https://m.juicewrldapi.com' });
    const serverUrl = settings.serverUrl || 'https://m.juicewrldapi.com';
    if (!isSafeText(String(endpoint || ''), 1024)) {
      return { error: 'Invalid endpoint' };
    }
    const url = new URL(endpoint, serverUrl);

    const postData = JSON.stringify(data);
    if (Buffer.byteLength(postData) > MAX_API_BODY) {
      return { error: 'Request body too large' };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'Unsupported protocol' };
    }

    return new Promise((resolve) => {
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Host': url.host,
          'User-Agent': 'JuiceWRLD-API-Desktop/1.0.0',
          'Accept': 'application/json, text/plain, */*',
          'Connection': 'close'
        },
        timeout: 10000,
        httpVersion: '1.1'
      };

      console.log('[HTTP] POST Request options:', JSON.stringify(options, null, 2));
      console.log('[HTTP] POST Full URL:', url.toString());
      console.log('[HTTP] POST Data:', postData);

      const request = lib.request(options, (response) => {
        console.log('[HTTP] POST Response status:', response.statusCode);
        console.log('[HTTP] POST Response headers:', response.headers);
        
        let responseData = '';
        let received = 0;

        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_API_BODY) {
            request.destroy();
            resolve({ error: 'Response too large' });
            return;
          }
          responseData += chunk;
        });

        response.on('end', () => {
          if (response.statusCode >= 400) {
            resolve({ error: `HTTP ${response.statusCode}: ${response.statusMessage || 'Request failed'}` });
            return;
          }

          try {
            if (String(responseData).trim() === '') {
              resolve({ error: 'Empty response from server' });
              return;
            }

            const jsonData = JSON.parse(responseData);
            resolve(jsonData);
          } catch (error) {
            resolve({ error: 'Invalid response format' });
          }
        });
      });

      request.on('error', () => {
        resolve({ error: 'Network error. Please try again.' });
      });

      request.write(postData);
      request.end();

      request.setTimeout(10000, () => {
        request.destroy();
        resolve({ error: 'Request timed out' });
      });
    });
  } catch (error) {
    return { error: 'Unexpected error' };
  }
});

ipcMain.handle('check-server-status', async () => {
  try {
    const settings = store.get('settings', { serverUrl: 'https://m.juicewrldapi.com' });
    const serverUrl = settings.serverUrl || 'https://m.juicewrldapi.com';
    const url = new URL('/status/', serverUrl);
    
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'error', message: 'Unsupported protocol' };
    }

    return new Promise((resolve) => {
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Host': url.host,
          'User-Agent': 'JuiceWRLD-API-Desktop/1.0.0',
          'Accept': 'application/json',
          'Connection': 'close'
        },
        timeout: 5000
      };

      const request = lib.request(options, (response) => {
        response.on('data', () => {});
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 500) {
            resolve({
              status: 'running',
              message: `Server is running at ${serverUrl}`,
              port: options.port
            });
          } else {
            resolve({
              status: 'error',
              message: `Server returned status ${response.statusCode}`,
              port: options.port
            });
          }
        });
      });

      request.on('error', (error) => {
        if (error.code === 'ECONNREFUSED') {
          resolve({
            status: 'not_running',
            message: `Server is not running at ${serverUrl}`,
            suggestion: `Start your server at ${serverUrl}`,
            port: options.port,
            error: error.code
          });
        } else {
          resolve({
            status: 'error',
            message: `Connection error: ${error.message}`,
            port: options.port,
            error: error.code
          });
        }
      });

      request.setTimeout(5000, () => {
        request.destroy();
        resolve({
          status: 'timeout',
          message: 'Connection timeout - server may be slow to respond',
          port: options.port
        });
      });

      request.end();
    });
  } catch (error) {
    return {
      status: 'error',
      message: `Failed to check server status: ${error.message}`,
      error: error.message
    };
  }
});

ipcMain.handle('get-local-storage-info', () => {
  return getLocalStorageInfo();
});

ipcMain.handle('open-local-folder', () => {
  const { shell } = require('electron');
  shell.openPath(LOCAL_STORAGE_DIR);
  return true;
});

ipcMain.handle('download-file-to-local', async (event, filepath, serverUrl, serverFiles = null) => {
  try {
    if (!isSafeText(String(filepath || ''), 4096)) {
      return { error: 'Invalid file path', success: false };
    }

    const metadata = loadLocalMetadata();
    const localPath = getLocalFilePath(filepath);

    if (isFileLocal(filepath)) {
      if (serverFiles && Array.isArray(serverFiles)) {
        const serverFile = serverFiles.find(f => (f.filepath === filepath) || (f.path === filepath));
        if (serverFile) {
          try {
            let stats = fileStatsCache.get(localPath);
            if (!stats) {
              stats = fs.statSync(localPath);
              fileStatsCache.set(localPath, stats);
            }
            const entry = metadata.files[filepath];
            
            if (typeof serverFile.size === 'number' && stats.size !== serverFile.size) {
            } else if (serverFile.hash && entry && entry.hash && entry.size === stats.size) {
              if (entry.hash === serverFile.hash) {
                return { success: true, message: 'File already exists locally and is up to date', localPath: localPath, alreadyExists: true, upToDate: true };
              }
            } else if (serverFile.hash) {
              const localHash = await computeFileHash(localPath, 'md5');
              if (localHash === serverFile.hash) {
                return { success: true, message: 'File already exists locally and is up to date', localPath: localPath, alreadyExists: true, upToDate: true };
              }
            } else {
              return { success: true, message: 'File already exists locally and is up to date', localPath: localPath, alreadyExists: true, upToDate: true };
            }
          } catch (_) {}
        }
      }
    }

    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const downloadUrl = new URL(`/download?filepath=${encodeURIComponent(filepath)}`, serverUrl || 'https://m.juicewrldapi.com');
    if (downloadUrl.protocol !== 'http:' && downloadUrl.protocol !== 'https:') {
      return { error: 'Unsupported protocol', success: false };
    }

        const nameOnly = path.basename(filepath)
        activeTransfers.set(filepath, { filepath, name: nameOnly, downloaded: 0, total: null, status: 'in-progress' })
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) { try { win.webContents.send('transfer-start', { filepath, name: nameOnly }) } catch(_) {} }

    return new Promise((resolve) => {
      const isHttps = downloadUrl.protocol === 'https:';
      const lib = isHttps ? https : http;
      const options = {
        hostname: downloadUrl.hostname,
        port: downloadUrl.port ? parseInt(downloadUrl.port, 10) : (isHttps ? 443 : 80),
        path: downloadUrl.pathname + downloadUrl.search,
        method: 'GET',
        headers: {
          'Host': downloadUrl.host,
          'User-Agent': 'JuiceWRLD-API-Desktop/1.0.0',
          'Accept': '*/*',
          'Connection': 'close'
        },
        timeout: 300000
      };

      const request = lib.request(options, (response) => {
        if (response.statusCode !== 200) {
          let errData = '';
          response.on('data', c => errData += c);
          response.on('end', () => {
            if (mainWindow) { try { mainWindow.webContents.send('transfer-error', { filepath, error: 'HTTP ' + response.statusCode }); } catch(_) {} }
            resolve({ success: false, error: 'Download failed' });
          });
          return;
        }

        const contentLength = parseInt(response.headers['content-length'] || '0', 10);
        if (activeTransfers.has(filepath)) {
          const t = activeTransfers.get(filepath); t.total = contentLength || null; activeTransfers.set(filepath, t)
        }
        if (contentLength && contentLength > MAX_DOWNLOAD_BYTES) {
          request.destroy();
          if (mainWindow) { try { mainWindow.webContents.send('transfer-error', { filepath, error: 'File too large' }); } catch(_) {} }
          resolve({ success: false, error: 'File too large' });
          return;
        }

        const fileStream = fs.createWriteStream(localPath);
        const crypto = require('crypto');
        const hasher = crypto.createHash('md5');
        let downloadedBytes = 0;
        let aborted = false;

        if (mainWindow) {
          try { mainWindow.webContents.send('transfer-progress', { filepath, downloaded: 0, total: contentLength || null }); } catch(_) {}
        }

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          try { hasher.update(chunk); } catch (_) {}
          if (downloadedBytes > MAX_DOWNLOAD_BYTES && !aborted) {
            aborted = true;
            response.destroy();
            fileStream.destroy();
            try { fs.unlinkSync(localPath); } catch (_) {}
            if (mainWindow) { try { mainWindow.webContents.send('transfer-error', { filepath, error: 'Download too large' }); } catch(_) {} }
            resolve({ success: false, error: 'Download too large' });
            return;
          }
          const wins2 = BrowserWindow.getAllWindows()
          if (activeTransfers.has(filepath)) { const t = activeTransfers.get(filepath); t.downloaded = downloadedBytes; activeTransfers.set(filepath, t) }
          for (const win of wins2) { try { win.webContents.send('transfer-progress', { filepath, downloaded: downloadedBytes, total: contentLength || null }); } catch(_) {} }
        });

        fileStream.on('finish', () => {
          let fileHash = null;
          try { fileHash = hasher.digest('hex'); } catch (_) { fileHash = null; }
          metadataWriteQueue = metadataWriteQueue.then(async () => {
            const m = loadLocalMetadata();
            const prev = m.files[filepath];
            const isUpdate = Boolean(prev);
            let sizeDifference = 0;
            if (isUpdate) sizeDifference = downloadedBytes - (prev.size || 0);
            m.files[filepath] = {
              filename: path.basename(filepath),
              filepath: filepath,
              localPath: localPath,
              downloadedAt: new Date().toISOString(),
              size: downloadedBytes,
              serverUrl: serverUrl,
              hash: fileHash,
              mtimeMs: (function(){ try { const st = fs.statSync(localPath); return st && st.mtimeMs ? Math.floor(st.mtimeMs) : null; } catch(_) { return null; } })()
            };
            fileStatsCache.delete(localPath);
            if (isUpdate) m.totalSize += sizeDifference; else m.totalSize += downloadedBytes;
            if (saveLocalMetadata(m)) {
              activeTransfers.delete(filepath)
              const wins3 = BrowserWindow.getAllWindows()
              for (const win of wins3) { try { win.webContents.send('transfer-complete', { filepath, size: downloadedBytes }); } catch(_) {} }
              ;(async()=>{
                try {
                  let tags = null;
                  const lower = (localPath || '').toLowerCase();
                  const isVideo = ['.mp4','.webm','.mkv','.mov','.avi','.m4v'].some(ext => lower.endsWith(ext));
                  if (!isVideo) {
                    try {
                      const mmModule = await import('music-metadata');
                      const mm = (mmModule && mmModule.parseFile) ? mmModule : (mmModule && mmModule.default ? mmModule.default : null);
                      if (mm && typeof mm.parseFile === 'function') {
                        const t = await mm.parseFile(localPath);
                        tags = { artist: t.common.artist||null, title: t.common.title||null, album: t.common.album||null, albumArtist: t.common.albumartist||null, year: t.common.year||null, genre: t.common.genre ? t.common.genre.join(', ') : null, track: t.common.track ? t.common.track.no : null };
                        if (t.common.picture && t.common.picture.length>0) {
                          const p = t.common.picture[0];
                          try { const b64 = Buffer.from(p.data).toString('base64'); const mime = (p.format && /^image\//.test(p.format)) ? p.format : 'image/jpeg'; tags.albumArt = `data:${mime};base64,${b64}`; } catch(_) {}
                        }
                      }
                    } catch(_) {}
                  }
                  const statsNow = (function(){ try { const st = fs.statSync(localPath); return st && st.mtimeMs ? Math.floor(st.mtimeMs) : null; } catch(_) { return null; } })();
                  if (tags) {
                    metadataWriteQueue = metadataWriteQueue.then(async () => {
                      const m2 = loadLocalMetadata();
                      const entry = m2.files[filepath] || {};
                      if (tags.title && (!entry.displayTitle || entry.displayTitle !== tags.title)) entry.displayTitle = tags.title;
                      if (tags.artist && (!entry.displayArtist || entry.displayArtist !== tags.artist)) entry.displayArtist = tags.artist;
                      if (tags.album && (!entry.displayAlbum || entry.displayAlbum !== tags.album)) entry.displayAlbum = tags.album;
                      m2.files[filepath] = entry;
                      saveLocalMetadata(m2);
                    });
                    tryGenerateAudioThumbnail(localPath, statsNow, tags || {});
                  } else if (isVideo) {
                    await tryGenerateVideoThumbnail(localPath, statsNow);
                  }
                } catch(_) {}
              })()
              resolve({
                success: true,
                message: isUpdate ? 'File updated successfully' : 'File downloaded successfully',
                localPath: localPath,
                size: downloadedBytes,
                alreadyExists: false,
                wasUpdate: isUpdate,
                sizeDifference: sizeDifference
              });
            } else {
              if (mainWindow) { try { mainWindow.webContents.send('transfer-error', { filepath, error: 'Failed to save metadata' }); } catch(_) {} }
              resolve({ success: false, error: 'Failed to save metadata' });
            }
          });
        });

        fileStream.on('error', () => {
          try { fs.unlinkSync(localPath); } catch (_) {}
          activeTransfers.delete(filepath)
          const wins4 = BrowserWindow.getAllWindows()
          for (const win of wins4) { try { win.webContents.send('transfer-error', { filepath, error: 'File write error' }); } catch(_) {} }
          resolve({ success: false, error: 'File write error' });
        });

        response.pipe(fileStream);
      });

      request.on('error', () => {
        activeTransfers.delete(filepath)
        const wins5 = BrowserWindow.getAllWindows()
        for (const win of wins5) { try { win.webContents.send('transfer-error', { filepath, error: 'Network error' }); } catch(_) {} }
        resolve({ success: false, error: 'Network error. Please try again.' });
      });

      request.setTimeout(300000, () => {
        request.destroy();
        activeTransfers.delete(filepath)
        const wins6 = BrowserWindow.getAllWindows()
        for (const win of wins6) { try { win.webContents.send('transfer-error', { filepath, error: 'Timeout' }); } catch(_) {} }
        resolve({ success: false, error: 'Download timed out' });
      });

      request.end();
    });

  } catch (error) {
    return { 
      error: getUserFriendlyError(error, 'Download failed'),
      success: false
    };
  }
});



ipcMain.handle('remove-local-file', async (event, filepath) => {
  try {
    console.log(`[Main] Remove local file requested: ${filepath}`);
    appendJobLog(`DELETE request: ${filepath}`)
    
    if (!isSafeText(String(filepath || ''), 4096)) {
      console.error(`[Main] Invalid file path: ${filepath}`);
      return { success: false, error: 'Invalid file path' };
    }

    const metadata = loadLocalMetadata();
    const localPath = getLocalFilePath(filepath);
    console.log(`[Main] Local path for deletion: ${localPath}`);

    if (fs.existsSync(localPath)) {
      console.log(`[Main] File exists, proceeding with deletion: ${localPath}`);
      const stats = fs.statSync(localPath);
      console.log(`[Main] File stats: size=${stats.size}, isFile=${stats.isFile()}, isDirectory=${stats.isDirectory()}`);
      
      if (stats.isDirectory()) {
        console.error(`[Main] Cannot delete directory: ${localPath}`);
        return { success: false, error: 'Cannot delete directory' };
      }
      
      fs.unlinkSync(localPath);
      console.log(`[Main] File successfully deleted: ${localPath}`);
      appendJobLog(`DELETE ok: ${filepath} (freed ${stats.size} bytes)`)
      
      if (metadata.files[filepath]) {
        const fileSize = metadata.files[filepath].size || 0;
        metadata.totalSize -= fileSize;
        delete metadata.files[filepath];
        console.log(`[Main] Updated metadata: removed ${fileSize} bytes, new total: ${metadata.totalSize}`);
        saveLocalMetadata(metadata);
      }
      
      return { 
        success: true, 
        message: 'File removed from local storage',
        freedSpace: stats.size
      };
    } else {
      console.warn(`[Main] File not found locally: ${localPath}`);
      appendJobLog(`DELETE miss: ${filepath} (not found)`) 
      return { 
        success: false, 
        error: 'File not found locally' 
      };
    }
  } catch (error) {
    console.error(`[Main] Error removing file ${filepath}:`, error);
    appendJobLog(`DELETE error: ${filepath} (${error && error.message})`)
    return { 
      error: getUserFriendlyError(error, 'Failed to remove file'),
      success: false
    };
  }
});

ipcMain.handle('get-local-files', () => {
  try {
    console.log('[Storage] getLocalFiles called');
    
    const metadata = loadLocalMetadata();
    console.log('[Storage] Loaded metadata:', metadata);
    console.log('[Storage] Metadata files count:', Object.keys(metadata.files || {}).length);
    
    const files = Object.entries(metadata.files || {}).map(([filepath, fileInfo]) => ({
      filename: fileInfo.filename || path.basename(filepath),
      filepath,
      localPath: fileInfo.localPath || getLocalFilePath(filepath),
      size: fileInfo.size || null,
      downloadedAt: fileInfo.downloadedAt,
      serverUrl: fileInfo.serverUrl,
      hash: fileInfo.hash || null,
    mtimeMs: fileInfo.mtimeMs || null,
    displayTitle: fileInfo.displayTitle || null,
    displayArtist: fileInfo.displayArtist || null,
    displayAlbum: fileInfo.displayAlbum || null,
    displayAlbumArtist: fileInfo.displayAlbumArtist || null
    }));
    console.log(`[Storage] Returning ${files.length} local files (no fs checks)`);
    return { files, totalCount: files.length };
  } catch (error) {
    console.error(`[Storage] Failed to get local files: ${error.message}`);
    return { error: getUserFriendlyError(error, 'Failed to get local files') };
  }
});

ipcMain.handle('get-local-file-path', (event, filepath) => {
  try {
    if (!isSafeText(String(filepath || ''), 4096)) return null;
    if (isFileLocal(filepath)) {
      return getLocalFilePath(filepath);
    }
    return null;
  } catch (error) {
    return null;
  }
});

ipcMain.handle('show-file-in-folder', (event, filePath) => {
  try {
    if (!isSafeText(String(filePath || ''), 4096)) {
      return { success: false, error: 'Invalid file path' };
    }
    const { shell } = require('electron');
    const fullPath = getLocalFilePath(filePath);
    if (fs.existsSync(fullPath)) {
      shell.showItemInFolder(fullPath);
      return { success: true };
    } else {
      return { success: false, error: 'File does not exist' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-file-exists', (event, filePath) => {
  try {
    if (!isSafeText(String(filePath || ''), 4096)) return false;
    const fullPath = getLocalFilePath(filePath);
    const exists = fs.existsSync(fullPath);
    return exists;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('get-local-stats', () => {
  try {
    const metadata = loadLocalMetadata();
    return {
      lastSync: metadata.lastSync || null,
      syncCount: metadata.syncCount || 0,
      totalFiles: Object.keys(metadata.files || {}).length,
      totalSize: metadata.totalSize || 0
    };
  } catch (error) {
    console.error(`[Storage] Failed to get local stats: ${error.message}`);
    return {
      lastSync: null,
      syncCount: 0,
      totalFiles: 0,
      totalSize: 0
    };
  }
});

ipcMain.handle('update-sync-stats', (event, lastCommitId = null) => {
  try {
    const metadata = loadLocalMetadata();
    metadata.lastSync = new Date().toISOString();
    metadata.syncCount = (metadata.syncCount || 0) + 1;
    
    if (lastCommitId) {
      metadata.lastCommitId = lastCommitId;
    }
    
    if (saveLocalMetadata(metadata)) {
      console.log(`[Storage] Updated sync stats: lastSync=${metadata.lastSync}, syncCount=${metadata.syncCount}, lastCommitId=${lastCommitId || 'none'}`);
      return { success: true };
    } else {
      return { success: false, error: 'Failed to save metadata' };
    }
  } catch (error) {
    console.error(`[Storage] Failed to update sync stats: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-storage-path', () => {
  try {
    return {
      currentPath: LOCAL_STORAGE_DIR,
      defaultPath: getStoragePath(),
      isCustom: store.get('settings.customStoragePath') !== undefined,
      exists: fs.existsSync(LOCAL_STORAGE_DIR)
    };
  } catch (error) {
    console.error(`[Storage] Failed to get storage path: ${error.message}`);
    return { error: getUserFriendlyError(error, 'Failed to get storage path') };
  }
});

ipcMain.handle('set-storage-path', async (event, newPath) => {
  try {
    console.log('[Storage] set-storage-path called with:', newPath);
    
    if (!newPath || typeof newPath !== 'string') {
      console.log('[Storage] Invalid path provided:', newPath);
      return { success: false, error: 'Invalid path provided' };
    }

    if (!fs.existsSync(newPath)) {
      try {
        fs.mkdirSync(newPath, { recursive: true });
        console.log(`[Storage] Created new storage directory: ${newPath}`);
      } catch (mkdirError) {
        return { success: false, error: `Failed to create directory: ${mkdirError.message}` };
      }
    }

    try {
      const testFile = path.join(newPath, '.test-write');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (writeError) {
      return { success: false, error: `Directory is not writable: ${writeError.message}` };
    }

    const settings = store.get('settings', {});
    settings.customStoragePath = newPath;
    store.set('settings', settings);

    updateStoragePaths();

    console.log(`[Storage] Storage path updated to: ${newPath}`);
    const result = { 
      success: true, 
      message: 'Storage path updated successfully',
      newPath: newPath
    };
    console.log('[Storage] Returning success result:', result);
    return result;
  } catch (error) {
    console.error(`[Storage] Failed to set storage path: ${error.message}`);
    const errorResult = { success: false, error: getUserFriendlyError(error, 'Failed to set storage path') };
    console.log('[Storage] Returning error result:', errorResult);
    return errorResult;
  }
});

ipcMain.handle('reset-storage-path', () => {
  try {
    const settings = store.get('settings', {});
    delete settings.customStoragePath;
    store.set('settings', settings);

    updateStoragePaths();

    console.log(`[Storage] Storage path reset to default: ${LOCAL_STORAGE_DIR}`);
    return { 
      success: true, 
      message: 'Storage path reset to default',
      newPath: LOCAL_STORAGE_DIR
    };
  } catch (error) {
    console.error(`[Storage] Failed to reset storage path: ${error.message}`);
    return { success: false, error: `Failed to reset storage path: ${error.message}` };
  }
});

ipcMain.handle('migrate-storage', async (event, newPath) => {
  try {
    if (!newPath || typeof newPath !== 'string') {
      return { success: false, error: 'Invalid path provided' };
    }

    const oldPath = LOCAL_STORAGE_DIR;
    
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: 'No existing storage to migrate' };
    }

    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }

    const copyRecursive = (src, dest) => {
      if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }
        const files = fs.readdirSync(src);
        files.forEach(file => {
          copyRecursive(path.join(src, file), path.join(dest, file));
        });
      } else {
        fs.copyFileSync(src, dest);
      }
    };

    copyRecursive(oldPath, newPath);
    console.log(`[Storage] Migrated storage from ${oldPath} to ${newPath}`);

    const settings = store.get('settings', {});
    settings.customStoragePath = newPath;
    store.set('settings', settings);
    updateStoragePaths();

    return { 
      success: true, 
      message: 'Storage migrated successfully',
      oldPath: oldPath,
      newPath: newPath
    };
  } catch (error) {
    console.error(`[Storage] Failed to migrate storage: ${error.message}`);
    return { success: false, error: `Failed to migrate storage: ${error.message}` };
  }
});

ipcMain.handle('get-icon-info', () => {
  try {
    const iconPath = getIconPath();
    const trayIconPath = getTrayIconPath();
    const iconInfo = {
      currentPath: iconPath,
      trayIconPath: trayIconPath,
      isPackaged: app.isPackaged,
      platform: process.platform,
      dirname: __dirname,
      resourcesPath: process.resourcesPath,
      possiblePaths: [
        path.join(__dirname, 'build/icon.ico'),
        path.join(__dirname, 'build/icon.png'),
        path.join(__dirname, 'assets/icon.png'),
        path.join(__dirname, 'assets/icon_128x128.png')
      ],
      trayIconPaths: [
        path.join(__dirname, 'assets/icon_16x16.png'),
        path.join(__dirname, 'assets/icon_32x32.png'),
        path.join(__dirname, 'assets/icon_48x48.png'),
        path.join(__dirname, 'assets/icon_64x64.png')
      ]
    };
    
    if (app.isPackaged) {
      iconInfo.resourcePath = process.platform === 'win32' 
        ? path.join(process.resourcesPath, 'icon.ico')
        : path.join(process.resourcesPath, 'icon.icns');
    }
    
    iconInfo.existingPaths = [];
    for (const path of iconInfo.possiblePaths) {
      if (fs.existsSync(path)) {
        iconInfo.existingPaths.push(path);
      }
    }
    
    if (iconInfo.resourcePath && fs.existsSync(iconInfo.resourcePath)) {
      iconInfo.existingPaths.push(iconInfo.resourcePath);
    }
    
    iconInfo.existingTrayPaths = [];
    for (const path of iconInfo.trayIconPaths) {
      if (fs.existsSync(path)) {
        iconInfo.existingTrayPaths.push(path);
      }
    }
    
    if (tray) {
      try {
        const trayIcon = tray.getImage();
        if (trayIcon) {
          const size = trayIcon.getSize();
          iconInfo.trayIconSize = `${size.width}x${size.height}`;
        }
      } catch (error) {
        iconInfo.trayIconSize = 'Error getting size';
      }
    }
    
    return iconInfo;
  } catch (error) {
    console.error(`[Icon] Failed to get icon info: ${error.message}`);
    return { error: `Failed to get icon info: ${error.message}` };
  }
});

ipcMain.handle('refresh-tray-icon', () => {
  try {
    if (!tray) {
      return { success: false, error: 'Tray not initialized' };
    }
    
    const newIcon = createOptimizedTrayIcon();
    if (newIcon) {
      tray.setImage(newIcon);
      console.log('[Tray] Icon refreshed successfully');
      return { success: true, message: 'Tray icon refreshed' };
    } else {
      return { success: false, error: 'Failed to create optimized icon' };
    }
  } catch (error) {
    console.error('[Tray] Failed to refresh icon:', error.message);
    return { success: false, error: `Failed to refresh icon: ${error.message}` };
  }
});

ipcMain.handle('trigger-background-sync', async () => {
  try {
    if (bgSyncWorker) bgSyncWorker.postMessage({ type: 'run-now' })
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      try { win.webContents.send('menu-new-sync') } catch (_) {}
    }
    return { success: true }
  } catch (e) {
    return { success: false }
  }
})

ipcMain.handle('notify-sync-complete', async () => {
  try {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      try { win.webContents.send('library-updated') } catch (_) {}
    }
    return { success: true }
  } catch (_) {
    return { success: false }
  }
})

ipcMain.handle('win-minimize', () => {
  try { if (mainWindow) mainWindow.minimize(); return true; } catch (_) { return false; }
});
ipcMain.handle('win-maximize', () => {
  try {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return true;
  } catch (_) { return false; }
});
ipcMain.handle('win-close', () => {
  try { if (mainWindow) mainWindow.close(); return true; } catch (_) { return false; }
});

ipcMain.handle('save-playlists', async (event, playlists) => {
  try {
    store.set('playlists', playlists);
    return { success: true };
  } catch (error) {
    console.error('[Playlists] Failed to save playlists:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-playlists', async () => {
  try {
    const playlists = store.get('playlists', []);
    return { success: true, playlists };
  } catch (error) {
    console.error('[Playlists] Failed to load playlists:', error.message);
    return { success: false, error: error.message, playlists: [] };
  }
});

ipcMain.handle('save-play-history', async (event, history) => {
  try {
    store.set('playHistory', Array.isArray(history) ? history : []);
    return { success: true };
  } catch (error) {
    console.error('[History] Failed to save play history:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-play-history', async () => {
  try {
    const history = store.get('playHistory', []);
    return { success: true, history };
  } catch (error) {
    console.error('[History] Failed to load play history:', error.message);
    return { success: false, error: error.message, history: [] };
  }
});

ipcMain.handle('get-favorites', async () => {
  try {
    const favorites = store.get('favorites', []);
    return { success: true, favorites };
  } catch (error) {
    return { success: false, error: error.message, favorites: [] };
  }
});

ipcMain.handle('save-favorites', async (event, favorites) => {
  try {
    const list = Array.isArray(favorites) ? favorites : [];
    store.set('favorites', list);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-thumbnail-path', async (event, localPath, mtimeMs) => {
  try {
    if (typeof localPath !== 'string' || !localPath) return null;
    const crypto = require('crypto');
    const key = `${localPath}:${mtimeMs || 'na'}`;
    const name = crypto.createHash('md5').update(key).digest('hex');
    const exts = ['.jpg', '.jpeg', '.png'];
    const dir = getThumbnailsPath();
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p)) {
        try {
          const { pathToFileURL } = require('url');
          return pathToFileURL(p).href;
        } catch (_) {
          return p;
        }
      }
    }
    return null;
  } catch (_) {
    return null;
  }
});

ipcMain.handle('save-thumbnail', async (event, localPath, mtimeMs, dataUrl) => {
  try {
    if (typeof localPath !== 'string' || !localPath) return { success: false };
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|jpg);base64,/.test(dataUrl)) return { success: false };
    const crypto = require('crypto');
    const key = `${localPath}:${mtimeMs || 'na'}`;
    const name = crypto.createHash('md5').update(key).digest('hex');
    const m = dataUrl.match(/^data:(.*?);base64,(.+)$/);
    if (!m) return { success: false };
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const buf = Buffer.from(b64, 'base64');
    const ext = mime.includes('png') ? '.png' : '.jpg';
    const dir = getThumbnailsPath();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name + ext);
    fs.writeFileSync(filePath, buf);
    try {
      const { pathToFileURL } = require('url');
      return { success: true, url: pathToFileURL(filePath).href, path: filePath };
    } catch (_) {
      return { success: true, url: filePath, path: filePath };
    }
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : 'error' };
  }
});

ipcMain.handle('generate-video-thumbnail', async (event, localPath, mtimeMs) => {
  try {
    const ok = await tryGenerateVideoThumbnail(localPath, mtimeMs);
    if (!ok) return { success: false };
    const target = getThumbnailCacheFile(localPath, mtimeMs, '.jpg');
    if (target && fs.existsSync(target)) {
      try { const { pathToFileURL } = require('url'); return { success: true, url: pathToFileURL(target).href, path: target }; } catch (_) { return { success: true, url: target, path: target }; }
    }
    const crypto = require('crypto');
    const key = `${localPath}:${mtimeMs || 'na'}`;
    const name = crypto.createHash('md5').update(key).digest('hex');
    const dir = getThumbnailsPath();
    const exts = ['.jpg','.jpeg','.png'];
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p)) {
        try { const { pathToFileURL } = require('url'); return { success: true, url: pathToFileURL(p).href, path: p }; } catch (_) { return { success: true, url: p, path: p }; }
      }
    }
    return { success: false };
  } catch (_) {
    return { success: false };
  }
});

ipcMain.handle('read-audio-metadata', async (event, filePath) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }
    
    const metadata = {};
    const ext = path.extname(filePath).toLowerCase();
    let stats = null;
    try { stats = fs.statSync(filePath); } catch (_) {}
    const size = stats && typeof stats.size === 'number' ? stats.size : null;
    const mtimeMs = stats && typeof stats.mtimeMs === 'number' ? Math.floor(stats.mtimeMs) : null;
    const cacheKey = `${filePath}:${size || 'na'}:${mtimeMs || 'na'}`;
    try {
      const cache = loadAudioMetadataCache();
      const cached = cache[cacheKey];
      if (cached && cached.metadata && typeof cached.metadata === 'object') {
        return { success: true, metadata: cached.metadata };
      }
    } catch (_) {}
    
    if (['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'].includes(ext)) {
      try {
        const mmModule = await import('music-metadata');
        const mm = (mmModule && mmModule.parseFile) ? mmModule : (mmModule && mmModule.default ? mmModule.default : null);
        if (!mm || typeof mm.parseFile !== 'function') {
          throw new Error('music-metadata parseFile not available');
        }
        const tags = await mm.parseFile(filePath);
        
        metadata.artist = tags.common.artist || null;
        metadata.title = tags.common.title || null;
        metadata.album = tags.common.album || null;
        metadata.year = tags.common.year || null;
        metadata.genre = tags.common.genre ? tags.common.genre.join(', ') : null;
        metadata.albumArtist = tags.common.albumartist || null;
        metadata.track = tags.common.track ? tags.common.track.no : null;
        metadata.comment = tags.common.comment ? tags.common.comment.join(' ') : null;
        metadata.composer = tags.common.composer ? tags.common.composer.join(', ') : null;
        metadata.discNumber = tags.common.disk ? tags.common.disk.no : null;
        
        if (tags.common.picture && tags.common.picture.length > 0) {
          const picture = tags.common.picture[0];
          try {
            const base64 = Buffer.from(picture.data).toString('base64');
            const mimeType = (picture.format && /^image\//.test(picture.format)) ? picture.format : 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${base64}`;
            metadata.albumArt = dataUrl;
          } catch (_) {
            metadata.albumArt = null;
          }
        }

        try {
          const cache = loadAudioMetadataCache();
          const { albumArt, ...metadataToCache } = metadata;
          cache[cacheKey] = { metadata: metadataToCache, size, mtimeMs, savedAt: Date.now() };
          const keys = Object.keys(cache);
          if (keys.length > 5000) {
            keys.slice(0, keys.length - 5000).forEach(k => { delete cache[k]; });
          }
          saveAudioMetadataCache(cache);
        } catch (_) {}
      } catch (mmError) {
        console.log('[Metadata] Music-metadata parsing failed:', mmError && mmError.message ? mmError.message : mmError);
      }
    }
    
    return { success: true, metadata };
  } catch (error) {
    console.error('[Metadata] Failed to read audio metadata:', error.message);
    return { success: false, error: error.message };
  }
});
