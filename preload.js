const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  showMessage: (options) => ipcRenderer.invoke('show-message', options),
  
  apiGet: (endpoint, params = {}) => ipcRenderer.invoke('api-get', endpoint, params),
  apiPost: (endpoint, data = {}) => ipcRenderer.invoke('api-post', endpoint, data),
  
  checkServerStatus: () => ipcRenderer.invoke('check-server-status'),
  
  getLocalStorageInfo: () => ipcRenderer.invoke('get-local-storage-info'),
  openLocalFolder: () => ipcRenderer.invoke('open-local-folder'),
  downloadFileToLocal: (filepath, serverUrl, serverFiles) => ipcRenderer.invoke('download-file-to-local', filepath, serverUrl, serverFiles),
    removeLocalFile: (filepath) => ipcRenderer.invoke('remove-local-file', filepath),
    appendJobLog: (line) => ipcRenderer.invoke('append-job-log', line),
  getLocalFiles: () => ipcRenderer.invoke('get-local-files'),
  getLocalFilePath: (filepath) => ipcRenderer.invoke('get-local-file-path', filepath),
      showFileInFolder: (filePath) => ipcRenderer.invoke('show-file-in-folder', filePath),
    checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
  getLocalStats: () => ipcRenderer.invoke('get-local-stats'),
  updateSyncStats: () => ipcRenderer.invoke('update-sync-stats'),
  
  getStoragePath: () => ipcRenderer.invoke('get-storage-path'),
  setStoragePath: (newPath) => ipcRenderer.invoke('set-storage-path', newPath),
  resetStoragePath: () => ipcRenderer.invoke('reset-storage-path'),
  migrateStorage: (newPath) => ipcRenderer.invoke('migrate-storage', newPath),
  
  getStartupStatus: () => ipcRenderer.invoke('get-startup-status'),
  getInstallScope: () => ipcRenderer.invoke('get-install-scope'),
  openPlayerMode: () => ipcRenderer.invoke('open-player-mode'),
  openMainUI: () => ipcRenderer.invoke('open-main-ui'),
  savePlaybackState: (state) => ipcRenderer.invoke('save-playback-state', state),
  getPlaybackState: () => ipcRenderer.invoke('get-playback-state'),
  clearPlaybackState: () => ipcRenderer.invoke('clear-playback-state'),
  readAudioMetadata: (filePath) => ipcRenderer.invoke('read-audio-metadata', filePath),
  minimizeWindow: () => ipcRenderer.invoke('win-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('win-maximize'),
  closeWindow: () => ipcRenderer.invoke('win-close'),
  
  savePlaylists: (playlists) => ipcRenderer.invoke('save-playlists', playlists),
  getPlaylists: () => ipcRenderer.invoke('get-playlists'),
  savePlayHistory: (history) => ipcRenderer.invoke('save-play-history', history),
  getPlayHistory: () => ipcRenderer.invoke('get-play-history'),
  getActiveTransfers: () => ipcRenderer.invoke('get-active-transfers'),
  triggerBackgroundSync: () => ipcRenderer.invoke('trigger-background-sync'),
  notifySyncComplete: () => ipcRenderer.invoke('notify-sync-complete'),
  getThumbnailPath: (localPath, mtimeMs) => ipcRenderer.invoke('get-thumbnail-path', localPath, mtimeMs),
  saveThumbnail: (localPath, mtimeMs, dataUrl) => ipcRenderer.invoke('save-thumbnail', localPath, mtimeMs, dataUrl),
  pathToFileURL: (p) => {
    try {
      const urlMod = require('url')
      if (urlMod && typeof urlMod.pathToFileURL === 'function') {
        return urlMod.pathToFileURL(p).href
      }
    } catch (_) {}
    try {
      const isWin = process.platform === 'win32'
      const normalized = String(p || '').replace(/\\/g, '/')
      const prefix = isWin ? 'file:///' : 'file://'
      return prefix + encodeURI(normalized)
    } catch (_) {
      return null
    }
  },
  
  onMenuNewSync: (callback) => ipcRenderer.on('menu-new-sync', callback),
  onMenuOpenSettings: (callback) => ipcRenderer.on('menu-open-settings', callback),
  onLibraryUpdated: (callback) => ipcRenderer.on('library-updated', callback),

  discordInit: (clientId) => ipcRenderer.invoke('discord-rpc-init', clientId),
  discordUpdate: (payload) => ipcRenderer.invoke('discord-rpc-update', payload),
  discordClear: () => ipcRenderer.invoke('discord-rpc-clear'),
  discordSetEnabled: (enabled) => ipcRenderer.invoke('discord-rpc-enabled', enabled),
  discordStatus: () => ipcRenderer.invoke('discord-rpc-status'),
  
  onTransferStart: (callback) => ipcRenderer.on('transfer-start', (_e, data) => callback(data)),
  onTransferProgress: (callback) => ipcRenderer.on('transfer-progress', (_e, data) => callback(data)),
  onTransferComplete: (callback) => ipcRenderer.on('transfer-complete', (_e, data) => callback(data)),
  onTransferError: (callback) => ipcRenderer.on('transfer-error', (_e, data) => callback(data)),
  
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
