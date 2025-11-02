let currentSettings = {};
let syncInProgress = false;
let syncTaskHandle = null;
let syncCancelled = false;

let activeRequests = new Map();
let currentTab = 'overview';
let serverConnected = false;
let lastSuccessfulUpdate = null;
let autoSyncTimer = null;
let settingsDirty = false;
let settingsBaseline = null;

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

const elements = {
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    
    syncBtn: document.getElementById('syncBtn'),
    syncStatus: document.getElementById('syncStatus'),
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    totalFiles: document.getElementById('totalFiles'),
    lastSync: document.getElementById('lastSync'),
    syncCount: document.getElementById('syncCount'),
    checkUpdatesBtn: document.getElementById('checkUpdatesBtn'),
    viewFilesBtn: document.getElementById('viewFilesBtn'),
    viewHistoryBtn: document.getElementById('viewHistoryBtn'),
    manageFoldersBtn: document.getElementById('manageFoldersBtn'),
    testConnectionBtn: document.getElementById('testConnectionBtn'),
    
    fileSearch: document.getElementById('fileSearch'),
    refreshFilesBtn: document.getElementById('refreshFilesBtn'),
    exportFilesBtn: document.getElementById('exportFilesBtn'),
    scanFilesBtn: document.getElementById('scanFilesBtn'),
    filesList: document.getElementById('filesList'),
    
    openLocalFolderBtn: document.getElementById('openLocalFolderBtn'),
    refreshLocalFilesBtn: document.getElementById('refreshLocalFilesBtn'),
    clearLocalStorageBtn: document.getElementById('clearLocalStorageBtn'),
    storageInfo: document.getElementById('storageInfo'),
    localFilesList: document.getElementById('localFilesList'),
    
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    exportHistoryBtn: document.getElementById('exportHistoryBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    historyList: document.getElementById('historyList'),
    
    refreshTransfersBtn: document.getElementById('refreshTransfersBtn'),
    clearCompletedBtn: document.getElementById('clearCompletedBtn'),
    exportTransfersBtn: document.getElementById('exportTransfersBtn'),
    transfersList: document.getElementById('transfersList'),
    
            startWithWindows: document.getElementById('startWithWindows'),
        minimizeToTray: document.getElementById('minimizeToTray'),
                showTrayNotifications: document.getElementById('showTrayNotifications'),
        autoSyncEnabled: document.getElementById('autoSyncEnabled'),
        autoSyncInterval: document.getElementById('autoSyncInterval'),
    maxTransfers: document.getElementById('maxTransfers'),
    logLevel: document.getElementById('logLevel'),
    serverUrl: document.getElementById('serverUrl'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            resetSettingsBtn: document.getElementById('resetSettingsBtn'),
        exportSettingsBtn: document.getElementById('exportSettingsBtn'),
        importSettingsBtn: document.getElementById('importSettingsBtn'),
    unsavedBadge: document.getElementById('unsavedBadge'),
    
    storagePath: document.getElementById('storagePath'),
    changeStoragePathBtn: document.getElementById('changeStoragePathBtn'),
    resetStoragePathBtn: document.getElementById('resetStoragePathBtn'),
    currentStorageLocation: document.getElementById('currentStorageLocation'),
    installationType: document.getElementById('installationType'),
    
    
    refreshFoldersBtn: document.getElementById('refreshFoldersBtn'),
    selectAllFoldersBtn: document.getElementById('selectAllFoldersBtn'),
    deselectAllFoldersBtn: document.getElementById('deselectAllFoldersBtn'),
    folderSelectionContainer: document.getElementById('folderSelectionContainer'),
    selectedFoldersCount: document.getElementById('selectedFoldersCount'),
    
    statusText: document.getElementById('statusText'),
    connectionStatus: document.getElementById('connectionStatus'),
    lastUpdate: document.getElementById('lastUpdate'),
    connectionTestResult: document.getElementById('connectionTestResult')
};

function jsString(value) {
    try { return JSON.stringify(String(value == null ? '' : value)); } catch (_) { return "''"; }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent)
    document.body.classList.toggle('is-mac', !!isMac)
    const min = document.getElementById('minimizeBtn')
    const max = document.getElementById('maximizeBtn')
    const cls = document.getElementById('closeBtn')
    if(min) min.onclick = ()=> window.electronAPI.minimizeWindow()
    if(max) max.onclick = ()=> window.electronAPI.maximizeWindow()
    if(cls) cls.onclick = ()=> window.electronAPI.closeWindow()
  } catch (_) {}
    initializeApp();

    setTimeout(async () => {
        console.log('[Renderer] Starting connection check...');
        try {
            await Promise.race([
                checkServerConnection(),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        console.log('[Renderer] Overall connection check timeout');
                        reject(new Error('Overall timeout'));
                    }, 15000);
                })
            ]);
        } catch (error) {
            console.error('[Renderer] Connection check wrapper failed:', error);
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Connection failed');
            updateStatus('Connection failed');
        }
        console.log('[Renderer] Connection check completed');
    }, 500);

    try { setupEventListeners(); } catch (e) { console.error('[Init] setupEventListeners failed:', e); }
    try { loadSettings(); } catch (e) { console.error('[Init] loadSettings failed:', e); }
    try { setupMenuListeners(); } catch (e) { console.error('[Init] setupMenuListeners failed:', e); }

    setTimeout(() => {
        try {
            if (!serverConnected) {
                const el = elements.connectionStatus;
                if (el && /Checking/i.test(el.textContent || '')) {
                    updateConnectionStatus('disconnected', 'Server not available');
                    updateSyncStatus('disconnected');
                    updateStatus('Server not available');
                }
            }
        } catch (_) {}
    }, 6000);

    try { bindTransferEvents(); } catch (e) { console.error('[Transfers] Bind events failed:', e); }
});

window.addEventListener('beforeunload', () => {
    cleanupRequests();
});

function initializeApp() {
    console.log('JuiceWRLD API Application Initialized');
    updateStatus('Ready');
    updateConnectionStatus('disconnected', 'Checking connection...');
    updateSyncStatus('disconnected');
    updateLastUpdate();
    updateStats();
    try { resumePlaybackIfAny(); } catch (_) {}
    try { initializeAccountTab(); } catch (e) { console.error('[Init] initializeAccountTab failed:', e); }
}

let backgroundAudio = null;
async function resumePlaybackIfAny() {
    try {
        const res = await window.electronAPI.getPlaybackState();
        if (!res || !res.success || !res.state) return;
        const state = res.state;
        if (!Array.isArray(state.queue) || state.queue.length === 0) return;
        if (!backgroundAudio) {
            backgroundAudio = document.createElement('audio');
            backgroundAudio.style.display = 'none';
            document.body.appendChild(backgroundAudio);
        }
        const item = state.queue[state.index] || state.queue[0];
        const fileUrl = await window.electronAPI.pathToFileURL(item.localPath);
        if (!fileUrl) return;
        if (backgroundAudio.src !== fileUrl) backgroundAudio.src = fileUrl;
        try { backgroundAudio.load(); } catch (_) {}
        if (typeof state.volume === 'number') backgroundAudio.volume = Math.max(0, Math.min(1, state.volume));
        if (typeof state.time === 'number') {
            const seekTo = Math.max(0, state.time);
            const setTime = () => {
                try { backgroundAudio.currentTime = seekTo; } catch(_) {}
            };
            if (isNaN(backgroundAudio.duration)) {
                backgroundAudio.addEventListener('loadedmetadata', function once(){
                    backgroundAudio.removeEventListener('loadedmetadata', once);
                    setTime();
                });
            } else {
                setTime();
            }
        }
        if (!state.paused) {
            try { await backgroundAudio.play(); } catch (_) {}
        }
        try { await window.electronAPI.clearPlaybackState(); } catch (_) {}
    } catch (_) {}
}

function setupEventListeners() {
    
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetTab = btn.dataset.tab;
            if (currentTab === 'settings' && targetTab !== 'settings' && settingsDirty) {
                const leave = confirm('You have unsaved changes. Save before leaving?\nPress OK to Save and leave, Cancel to discard.');
                if (leave) {
                    saveSettings().then(() => {
                        settingsDirty = false;
                        updateUnsavedBadge();
                        switchTab(targetTab);
                    });
                    return;
                } else {
                    settingsDirty = false;
                    updateUnsavedBadge();
                }
            }
            switchTab(targetTab);
        });
    });
    
    window.addEventListener('beforeunload', async (event) => {
        if (currentTab === 'settings' && settingsDirty) {
            event.returnValue = '';
        }
        if (currentTab === 'settings' && selectedFolders.size > 0) {
            try { await saveFolderSelection(); } catch (_) {}
        }
    });
    
    window.addEventListener('keydown', (e) => {
        const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.ctrlKey && String(e.key).toLowerCase() === 'h') {
            e.preventDefault();
            switchTab('overview');
        }
    });

    elements.syncBtn.addEventListener('click', startSyncOptimized);
    elements.checkUpdatesBtn.addEventListener('click', checkUpdates);
    elements.viewFilesBtn.addEventListener('click', () => switchTab('files'));
    elements.viewHistoryBtn.addEventListener('click', () => switchTab('history'));
    elements.manageFoldersBtn.addEventListener('click', () => switchTab('settings'));
    elements.testConnectionBtn.addEventListener('click', testConnection);
    
    elements.refreshFilesBtn.addEventListener('click', refreshFiles);
    elements.exportFilesBtn.addEventListener('click', exportFiles);
    elements.scanFilesBtn.addEventListener('click', scanFiles);
    elements.fileSearch.addEventListener('input', filterFiles);
    
    elements.openLocalFolderBtn.addEventListener('click', openLocalFolder);
    elements.refreshLocalFilesBtn.addEventListener('click', refreshLocalFiles);
    elements.clearLocalStorageBtn.addEventListener('click', clearLocalStorage);
    
    elements.refreshHistoryBtn.addEventListener('click', refreshHistory);
    elements.exportHistoryBtn.addEventListener('click', exportHistory);
    elements.clearHistoryBtn.addEventListener('click', clearHistory);
    
    elements.refreshTransfersBtn.addEventListener('click', refreshTransfers);
    elements.clearCompletedBtn.addEventListener('click', clearCompleted);
    elements.exportTransfersBtn.addEventListener('click', exportTransfers);
    
            elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.resetSettingsBtn.addEventListener('click', resetSettings);
        elements.exportSettingsBtn.addEventListener('click', exportSettings);
        elements.importSettingsBtn.addEventListener('click', importSettings);
        const markDirty = () => { settingsDirty = true; updateUnsavedBadge(); };
        elements.startWithWindows.addEventListener('change', markDirty);
        elements.minimizeToTray.addEventListener('change', markDirty);
        elements.showTrayNotifications.addEventListener('change', markDirty);
        elements.autoSyncEnabled.addEventListener('change', markDirty);
        elements.autoSyncInterval.addEventListener('change', markDirty);
        elements.maxTransfers.addEventListener('change', markDirty);
        elements.logLevel.addEventListener('change', markDirty);
        elements.serverUrl.addEventListener('input', markDirty);
        
        elements.autoSyncEnabled.addEventListener('change', () => {
            elements.autoSyncInterval.disabled = !elements.autoSyncEnabled.checked;
        });
    
            elements.changeStoragePathBtn.addEventListener('click', () => {
            console.log('[Storage] Change storage path button clicked!');
            changeStoragePath();
        });
    elements.resetStoragePathBtn.addEventListener('click', resetStoragePath);
    
    
    elements.refreshFoldersBtn.addEventListener('click', refreshAvailableFolders);
    elements.selectAllFoldersBtn.addEventListener('click', selectAllFolders);
    elements.deselectAllFoldersBtn.addEventListener('click', deselectAllFolders);
    

}

function updateUnsavedBadge() {
    try {
        if (elements.unsavedBadge) {
            elements.unsavedBadge.style.display = settingsDirty ? 'inline-flex' : 'none';
        }
    } catch (_) {}
}

function setupMenuListeners() {
    window.electronAPI.onMenuNewSync(() => {
        try {
            if (typeof syncInProgress !== 'undefined' && syncInProgress) {
                console.log('[Sync] Ignored new sync trigger (already in progress)');
                return;
            }
        } catch (_) {}
        startSyncOptimized();
    });
    
    window.electronAPI.onMenuOpenSettings(() => {
        switchTab('settings');
    });

    window.electronAPI.onLibraryUpdated(async () => {
        try {
            await refreshFiles();
            await updateStats();
        } catch (e) {
            console.error('[Library] Refresh after sync failed:', e);
        }
    });
}

async function saveCurrentFolderSelection() {
    if (currentTab === 'settings' && selectedFolders.size > 0) {
        console.log('[Folders] Saving current folder selection before leaving settings tab');
        await saveFolderSelection();
    }
}

function switchTab(tabName) {
    if (currentTab === 'settings' && tabName !== 'settings') {
        if (settingsDirty) {
            const leave = confirm('You have unsaved changes. Save before leaving?\nPress OK to Save and leave, Cancel to discard.');
            if (leave) {
                saveSettings().then(() => {
                    settingsDirty = false;
                    updateUnsavedBadge();
                    switchTab(tabName);
                });
                return;
            } else {
                settingsDirty = false;
                updateUnsavedBadge();
            }
        }
        saveCurrentFolderSelection();
    }
    
    cancelTabRequests(currentTab);
    
    currentTab = tabName;
    
    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    elements.tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === tabName);
    });
    
    showTabLoadingState(tabName);
    
    setTimeout(() => loadTabData(tabName), 0);
    
    if (currentSettings && currentSettings.lastActiveTab !== tabName) {
        currentSettings.lastActiveTab = tabName;
        window.electronAPI.saveSettings(currentSettings).catch(error => {
            console.error('Failed to save last active tab:', error);
        });
    }
}

function showTabLoadingState(tabName) {
    let loadingHTML = '';
    
    switch(tabName) {
        case 'files':
            loadingHTML = `
                <div class="loading-state" style="text-align: center; padding: 2rem;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #2196F3; margin-bottom: 1rem;"></i>
                    <p>Loading files...</p>
                </div>
            `;
            if (elements.filesList) elements.filesList.innerHTML = loadingHTML;
            const filesPagination = document.getElementById('files-pagination');
            if (filesPagination) filesPagination.style.display = 'none';
            break;
        case 'local-files':
            loadingHTML = `
                <div class="loading-state" style="text-align: center; padding: 2rem;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #2196F3; margin-bottom: 1rem;"></i>
                    <p>Loading local files...</p>
                </div>
            `;
            if (elements.localFilesList) elements.localFilesList.innerHTML = loadingHTML;
            const localFilesPagination = document.getElementById('local-files-pagination');
            if (localFilesPagination) localFilesPagination.style.display = 'none';
            break;
        case 'history':
            loadingHTML = `
                <div class="loading-state" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p>Loading history...</p>
                </div>
            `;
            if (elements.historyList) elements.historyList.innerHTML = loadingHTML;
            break;
        case 'transfers':
            loadingHTML = `
                <div class="loading-state" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p>Loading transfers...</p>
                </div>
            `;
            if (elements.transfersList) elements.transfersList.innerHTML = loadingHTML;
            break;
    }
}

function cancelTabRequests(tabName) {
    if (activeRequests.has(tabName)) {
        const request = activeRequests.get(tabName);
        if (request && request.abort) {
            request.abort();
            console.log(`[Tabs] Cancelled request for tab: ${tabName}`);
        }
        activeRequests.delete(tabName);
    }
    
    if (tabName === 'files' && elements.filesList) {
        elements.filesList.innerHTML = '<div class="loading-state" style="text-align: center; padding: 2rem; color: #999;"><i class="fas fa-times"></i><p>Request cancelled</p></div>';
        const filesPagination = document.getElementById('files-pagination');
        if (filesPagination) filesPagination.style.display = 'none';
    } else if (tabName === 'local-files' && elements.localFilesList) {
        elements.localFilesList.innerHTML = '<div class="loading-state" style="text-align: center; padding: 2rem; color: #999;"><i class="fas fa-times"></i><p>Request cancelled</p></div>';
        const localFilesPagination = document.getElementById('local-files-pagination');
        if (localFilesPagination) localFilesPagination.style.display = 'none';
    } else if (tabName === 'history' && elements.historyList) {
        elements.historyList.innerHTML = '<div class="loading-state" style="text-align: center; padding: 2rem; color: #999;"><i class="fas fa-times"></i><p>Request cancelled</p></div>';
    } else if (tabName === 'transfers' && elements.transfersList) {
        elements.transfersList.innerHTML = '<div class="loading-state" style="text-align: center; padding: 2rem; color: #999;"><i class="fas fa-times"></i><p>Request cancelled</p></div>';
    }
}

function createAbortableRequest(tabName) {
    const controller = new AbortController();
    activeRequests.set(tabName, controller);
    return controller.signal;
}

function cancelAllRequests() {
    console.log('[Requests] Cancelling all active requests...');
    
    for (const [tabName, request] of activeRequests) {
        if (request && request.abort) {
            request.abort();
            console.log(`[Requests] Cancelled request for tab: ${tabName}`);
        }
    }
    activeRequests.clear();
    
    console.log('[Requests] All requests cancelled');
}

function cleanupRequests() {
    cancelAllRequests();
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'overview':
            updateStats();
            break;
        case 'files':
            refreshFiles();
            break;
        case 'local-files':
            refreshLocalFiles();
            updateStorageInfo();
            break;
        case 'history':
            refreshHistory();
            break;
        case 'transfers':
            (async()=>{
                try{
                    const active = await window.electronAPI.getActiveTransfers();
                    if(Array.isArray(active)){
                        active.forEach(t=>{
                            const total = (typeof t.total==='number' && t.total>0)?t.total:null;
                            const downloaded = (typeof t.downloaded==='number'&&t.downloaded>0)?t.downloaded:0;
                            const progress = total? Math.max(0, Math.min(100, Math.round((downloaded/total)*100))) : (t.status==='in-progress'?0:100)
                            upsertTransfer(t.filepath, { name: t.name||t.filepath.split('/').pop(), status: t.status||'in-progress', progress })
                        })
                    }
                }catch(_){ }
                refreshTransfers();
            })()
            break;
        case 'settings':
            loadSettings();
            setTimeout(async () => {
                if (currentTab === 'settings') {
                    await refreshAvailableFolders();
                }
            }, 100);
            break;
    }
}

async function checkServerConnection() {
    console.log('[Renderer] checkServerConnection started');
    
    try {
        console.log('[Renderer] Checking server connection...');
        
        console.log('[Renderer] Calling checkServerStatus...');
        let serverStatus;
        try {
            serverStatus = await Promise.race([
                window.electronAPI.checkServerStatus(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Server status timeout')), 5000))
            ]);
            console.log('[Renderer] Server status received:', serverStatus);
        } catch (error) {
            console.error('[Renderer] Server status check failed:', error);
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Connection timeout');
            updateSyncStatus('disconnected');
            updateStatus('Connection timeout');
            return;
        }
        
        if (!serverStatus || serverStatus.status === 'not_running') {
            console.log('[Renderer] Server not running');
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Server not running');
            updateSyncStatus('disconnected');
            updateStatus('Server not running');
            return;
        }
        if (serverStatus.status === 'timeout') {
            console.log('[Renderer] Server connection timeout');
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Connection timeout');
            updateSyncStatus('disconnected');
            updateStatus('Connection timeout');
            return;
        }
        if (serverStatus.status === 'error') {
            console.log('[Renderer] Server connection error');
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Connection error');
            updateSyncStatus('disconnected');
            updateStatus('Connection error');
            return;
        }
        
        console.log('[Renderer] Testing API...');
        let response;
        try {
            response = await Promise.race([
                window.electronAPI.apiGet('status/'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 5000))
            ]);
            console.log('[Renderer] API response received:', response);
        } catch (error) {
            console.error('[Renderer] API test failed:', error);
            serverConnected = false;
            updateConnectionStatus('disconnected', 'API timeout');
            updateSyncStatus('disconnected');
            updateStatus('API timeout');
            return;
        }
        
        if (response && response.error) {
            console.error('[Renderer] Server returned error:', response.error);
            serverConnected = false;
            updateConnectionStatus('disconnected', 'Server error');
            updateSyncStatus('disconnected');
            updateStatus('Server error: ' + response.error);
        } else {
            console.log('[Renderer] Server connection successful');
            serverConnected = true;
            lastSuccessfulUpdate = Date.now();
            updateLastUpdate();
            updateConnectionStatus('connected', 'Connected');
            updateSyncStatus('ready');
            updateStatus('Connected to server');
        }
        
    } catch (error) {
        console.error('[Renderer] Connection check failed with error:', error);
        serverConnected = false;
        updateConnectionStatus('disconnected', 'Connection failed');
        updateSyncStatus('disconnected');
        updateStatus('Connection failed');
    } finally {
        console.log('[Renderer] checkServerConnection finished');
    }
}

async function testConnection() {
    const resultElement = elements.connectionTestResult;
    const button = elements.testConnectionBtn;
    
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    resultElement.innerHTML = 'Testing connection...';
    
    try {
        console.log('[Renderer] Testing server connection...');
        
        const startTime = Date.now();
        
        const serverStatus = await window.electronAPI.checkServerStatus();
        console.log('[Renderer] Server status:', serverStatus);
        
        if (serverStatus.status === 'not_running') {
            serverConnected = false;
            resultElement.innerHTML = `
                <div style="color: #f44336;">
                    <i class="fas fa-times-circle"></i> Server Not Running<br>
                    <small>${serverStatus.message}</small><br>
                    <small style="color: #ff9800;"><strong>${serverStatus.suggestion}</strong></small>
                </div>
            `;
            return;
        }
        
        const response = await window.electronAPI.apiGet('status/');
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        if (response.error) {
            console.error('[Renderer] Test failed:', response);
            serverConnected = false;
            resultElement.innerHTML = `
                <div style="color: #f44336;">
                    <i class="fas fa-times-circle"></i> API Test Failed<br>
                    <small>Error: ${response.error}</small><br>
                    <small>Status: ${response.statusCode || 'Unknown'}</small><br>
                    <small>Response Time: ${responseTime}ms</small>
                </div>
            `;
        } else {
            console.log('[Renderer] Test successful:', response);
            serverConnected = true;
            lastSuccessfulUpdate = Date.now();
            updateLastUpdate();
            resultElement.innerHTML = `
                <div style="color: #4CAF50;">
                    <i class="fas fa-check-circle"></i> Connection Successful<br>
                    <small>Response Time: ${responseTime}ms</small><br>
                    <small>Server: ${currentSettings.serverUrl || 'http://localhost:8000'}</small>
                </div>
            `;
        }
    } catch (error) {
        console.error('[Renderer] Test error:', error);
        let errorMessage = getUserFriendlyError(error, 'Test error');
        serverConnected = false;
        
        resultElement.innerHTML = `
            <div style="color: #f44336;">
                <i class="fas fa-exclamation-triangle"></i> Test Error<br>
                <small>${errorMessage}</small>
            </div>
        `;
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }
}

function updateConnectionStatus(status, message) {
    const statusElement = elements.connectionStatus;
    statusElement.className = `connection-status ${status}`;
    statusElement.innerHTML = `<i class="fas fa-${status === 'connected' ? 'check-circle' : 'times-circle'}"></i> ${message}`;
}

function isSyncInProgress() {
    return syncInProgress;
}

function cancelSync() {
    if (!syncInProgress) return;
    
    console.log('[Sync] Cancelling sync...');
    
    syncCancelled = true;
    
    cancelAllRequests();
    
    syncInProgress = false;
    
    if (elements.syncBtn) {
        elements.syncBtn.disabled = false;
        elements.syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync & Download';
    }
    
    updateStatus('Sync cancelled');
    updateSyncStatus('cancelled');
    
    hideProgress();
    
    const downloadProgress = document.getElementById('download-progress');
    if (downloadProgress) {
        downloadProgress.remove();
    }
    
    showToast('info', 'Sync cancelled');
    
    console.log('[Sync] Sync cancelled successfully');
}

async function startSync() {
    return startSyncOptimized();
}


function updateSyncStatus(status, progress = null) {
    if (!elements.syncStatus) {
        console.warn('[SyncStatus] syncStatus element not found, skipping update');
        return;
    }
    
    const statusIcon = elements.syncStatus.querySelector('.status-icon');
    const statusText = elements.syncStatus.querySelector('.status-text');
    
    if (!statusIcon || !statusText) {
        console.warn('[SyncStatus] Required status elements not found, skipping update');
        return;
    }
    
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    statusIcon.className = `status-icon ${status}`;
    
    switch(status) {
        case 'ready':
            statusText.textContent = 'Ready';
            statusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
            if (progressContainer) progressContainer.style.display = 'none';
            break;
        case 'disconnected':
            statusText.textContent = 'Disconnected';
            statusIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
            if (progressContainer) progressContainer.style.display = 'none';
            break;
        case 'syncing':
            if (progress !== null) {
                statusText.textContent = `Syncing: ${progress}%`;
                if (progressContainer && progressFill && progressText) {
                    progressContainer.style.display = 'block';
                    progressFill.style.width = progress + '%';
                    progressText.textContent = progress + '%';
                }
            } else {
                statusText.textContent = 'Syncing & Downloading...';
                if (progressContainer && progressFill && progressText) {
                    progressContainer.style.display = 'block';
                    progressFill.style.width = '0%';
                    progressText.textContent = '0%';
                }
            }
            statusIcon.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i>';
            break;
        case 'error':
            statusText.textContent = 'Error';
            statusIcon.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
            if (progressContainer) progressContainer.style.display = 'none';
            break;
        case 'cancelled':
            statusText.textContent = 'Sync Cancelled';
            statusIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
            if (progressContainer) progressContainer.style.display = 'none';
            break;
    }
}

function showProgress() {
    elements.progressContainer.style.display = 'block';
    simulateProgress();
}

function hideProgress() {
    elements.progressContainer.style.display = 'none';
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '0%';
}

function simulateProgress() {
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
        }
        
        elements.progressFill.style.width = progress + '%';
        elements.progressText.textContent = Math.round(progress) + '%';
    }, 200);
}

async function checkUpdates() {
    try {
        console.log('[CheckUpdates] Starting commit-based update check...');
        
        const serverUrl = currentSettings.serverUrl || 'http://localhost:8000';
        
        const serverStatus = await window.electronAPI.checkServerStatus();
        if (serverStatus.status === 'not_running' || serverStatus.status === 'error') {
            console.error('[CheckUpdates] Server not available:', serverStatus);
            showToast('error', 'Cannot connect to server. Please check if the server is running.');
            return;
        }
        
        const localStats = await window.electronAPI.getLocalStats();
        console.log('[CheckUpdates] Local stats:', localStats);
        
        let commitsEndpoint = 'commits';
        if (localStats && localStats.lastSync) {
            const lastSyncDate = new Date(localStats.lastSync);
            const timestamp = lastSyncDate.toISOString();
            commitsEndpoint = `commits?since_timestamp=${encodeURIComponent(timestamp)}`;
            console.log('[CheckUpdates] Getting commits since:', timestamp);
        } else {
            console.log('[CheckUpdates] No last sync timestamp, getting all commits');
        }
        
    const commitsResponse = await window.electronAPI.apiGet(commitsEndpoint);
        
        if (commitsResponse.error) {
            console.error('[CheckUpdates] Commits API call failed:', commitsResponse.error);
            showToast('error', 'Failed to check for updates: ' + commitsResponse.error);
            return;
        }
        
        console.log('[CheckUpdates] Commits response:', commitsResponse);
        
        let commits = [];
        if (Array.isArray(commitsResponse)) {
            commits = commitsResponse;
        } else if (commitsResponse && Array.isArray(commitsResponse.commits)) {
            commits = commitsResponse.commits;
        } else if (commitsResponse && Array.isArray(commitsResponse.data)) {
            commits = commitsResponse.data;
        }
        
        const hasCommits = commits.length > 0;
        const commitsCount = commits.length;
        
        console.log('[CheckUpdates] Commits found:', commitsCount, 'Has commits:', hasCommits);
        
        let updateMessage = '';
        let updateStatusText = '';
        
        if (hasCommits) {
            updateMessage = `${commitsCount} new commits available - sync to get updates`;
            updateStatusText = `${commitsCount} new commits available`;
            showToast('info', updateMessage);
            updateStatus(updateStatusText);
        } else {
            updateMessage = 'No updates available';
            updateStatusText = 'All files are up to date';
            showToast('success', updateMessage);
            updateStatus(updateStatusText);
        }
        
        console.log('[CheckUpdates] Summary:', {
            hasCommits,
            commitsCount,
            lastSync: localStats.lastSync
        });
        
    } catch (error) {
        console.error('[CheckUpdates] Exception:', error);
        showToast('error', 'Failed to check for updates: ' + error.message);
    }
}

async function getAllFiles() {
    try {
        updateStatus('Fetching file list from server...');
        
        console.log('[Files] Attempting to get all files with all=true parameter...');
        const response = await window.electronAPI.apiGet('files', { all: 'true' });
        
        if (!response || response.error || !Array.isArray(response.files)) {
            throw new Error(response && response.error ? response.error : 'Invalid files response');
        }
        
            const files = response.files || [];
        console.log(`[Files] Retrieved ${files.length} files from server`);
        console.log('[Files] Sample file structure:', files.length > 0 ? files[0] : 'No files');
        updateStatus(`Retrieved ${files.length} files from server`);
        return files;
        
    } catch (error) {
        console.error('Failed to get all files at once, falling back to pagination:', error);
        
        console.log('[Files] Falling back to paginated file retrieval...');
        let allFiles = [];
        let page = 1;
        let hasMore = true;
        
        updateStatus('Falling back to paginated file retrieval...');
        
        while (hasMore) {
            updateStatus(`Fetching page ${page}...`);
            console.log(`[Files] Fetching page ${page}...`);
            const response = await window.electronAPI.apiGet('files', { page: page, page_size: 200 });
            
            if (!response || response.error || !Array.isArray(response.files)) {
                throw new Error(response && response.error ? response.error : 'Invalid files response');
            }
            
            const files = response.files || [];
            allFiles = allFiles.concat(files);
            console.log(`[Files] Page ${page}: got ${files.length} files, total so far: ${allFiles.length}`);
            
            hasMore = response.pagination && response.pagination.has_next;
            page++;
            
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (page > 100) {
                console.warn('Reached maximum page limit, stopping pagination');
                break;
            }
        }
        
        updateStatus(`Retrieved ${allFiles.length} files from ${page - 1} pages`);
        console.log(`[Files] Retrieved ${allFiles.length} files from ${page - 1} pages`);
        return allFiles;
    }
}

async function refreshFiles() {
    if (currentTab !== 'files') {
        console.log('[Files] Tab switched, cancelling refresh');
        return;
    }
    
    if (filesLoading) {
        console.log('[Files] Already loading, skipping...');
        return;
    }
    
    try {
        filesLoading = true;
        
        elements.filesList.innerHTML = `
            <div class="loading-state" style="text-align: center; padding: 2rem;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #2196F3; margin-bottom: 1rem;"></i>
                <p>Fetching files from server...</p>
            </div>
        `;
        
        const files = await getAllFiles();
        
        if (currentTab !== 'files') {
            console.log('[Files] Tab switched during load, cancelling UI update');
            return;
        }
        
        allFilesData = files;
        filesData = files;
        currentFilesPage = 1;
        
        displayFilesPage(currentFilesPage);
        updateFilesPagination();
        updateStats();
    } catch (error) {
        if (currentTab === 'files') {
        showToast('error', 'Failed to load files: ' + error.message);
        displayFiles([]);
        }
    } finally {
        filesLoading = false;
    }
}

function displayFiles(files) {
    if (files.length === 0) {
        elements.filesList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-folder-open"></i>
                <p>No files found</p>
            </div>
        `;
        return;
    }
    
    const downloadAllButton = `
        <div style="margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>📁 ${files.length} Files Available</strong>
                    <div style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
                        Click "Download All" to sync all files to local storage
                    </div>
                </div>
                <button class="btn btn-primary" onclick="downloadAllFiles()" style="padding: 0.75rem 1.5rem;">
                    <i class="fas fa-download"></i> Download All Files
                </button>
            </div>
        </div>
    `;
    
    const filesHTML = files.map(file => `
        <div class="file-item" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #f0f0f0;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <i class="fas fa-music" style="color: #2196F3;"></i>
                <div>
                    <div style="font-weight: 500;">${file.name || file.filename || 'Unknown'}</div>
                    <div style="font-size: 0.9rem; color: #666;">${file.filepath || file.path || 'Unknown path'}</div>
                    <div style="font-size: 0.8rem; color: #999;">${file.size || 'Unknown size'} • ${file.date || file.modified || 'Unknown date'}</div>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-success" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick='downloadToLocal(${jsString(file.filepath || file.path || file.name || file.filename)})'>
                    <i class="fas fa-download"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    elements.filesList.innerHTML = downloadAllButton + filesHTML;
}

function displayFilesPage(page) {
    const startIndex = (page - 1) * FILES_PAGE_SIZE;
    const endIndex = startIndex + FILES_PAGE_SIZE;
    const pageData = filesData.slice(startIndex, endIndex);
    
    console.log(`[Files] Displaying page ${page}: items ${startIndex + 1}-${Math.min(endIndex, filesData.length)} of ${filesData.length}`);
    displayFiles(pageData);
}

function updateFilesPagination() {
    const totalPages = Math.ceil(filesData.length / FILES_PAGE_SIZE);
    const paginationContainer = document.getElementById('files-pagination');
    
    if (!paginationContainer) {
        console.warn('[Files] Pagination container not found');
        return;
    }
    
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const paginationHTML = `
        <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
            <button onclick="changeFilesPage(${currentFilesPage - 1})" 
                    ${currentFilesPage <= 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentFilesPage <= 1 ? '#f5f5f5' : '#fff'}; cursor: ${currentFilesPage <= 1 ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            
            <span style="color: #666;">
                Page ${currentFilesPage} of ${totalPages} 
                (${filesData.length} total files)
            </span>
            
            <button onclick="changeFilesPage(${currentFilesPage + 1})" 
                    ${currentFilesPage >= totalPages ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentFilesPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentFilesPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

function changeFilesPage(page) {
    const totalPages = Math.ceil(filesData.length / FILES_PAGE_SIZE);
    
    if (page < 1 || page > totalPages) {
        return;
    }
    
    currentFilesPage = page;
    displayFilesPage(page);
    updateFilesPagination();
    
    const filesList = document.getElementById('filesList');
    if (filesList) {
        filesList.scrollTop = 0;
    }
}

function filterFiles() {
    const searchTerm = (elements.fileSearch.value || '').toLowerCase().trim();

    if (!searchTerm) {
        filesData = allFilesData;
        currentFilesPage = 1;
        displayFilesPage(currentFilesPage);
        updateFilesPagination();
        return;
    }

    const source = allFilesData && Array.isArray(allFilesData) ? allFilesData : filesData;
    const filteredData = source.filter(file => 
        (file.name && file.name.toLowerCase().includes(searchTerm)) ||
        (file.filename && file.filename.toLowerCase().includes(searchTerm)) ||
        (file.filepath && file.filepath.toLowerCase().includes(searchTerm)) ||
        (file.path && file.path.toLowerCase().includes(searchTerm))
    );

    filesData = filteredData;
    currentFilesPage = 1;
    displayFilesPage(currentFilesPage);
    updateFilesPagination();
}



async function scanFiles() {
    showToast('info', 'Scanning for files...');
    try {
        await refreshFiles();
        showToast('success', 'File scan completed');
    } catch (error) {
        showToast('error', 'File scan failed');
    }
}

function exportFiles() {
    showToast('info', 'Exporting files...');
}

async function openLocalFolder() {
    try {
        const path = await window.electronAPI.openLocalFolder();
        if (path) {
            showToast('success', `Local folder opened: ${path}`);
            refreshLocalFiles();
        } else {
            showToast('info', 'No local folder selected or path invalid.');
        }
    } catch (error) {
        showToast('error', 'Failed to open local folder: ' + error.message);
    }
}

async function refreshLocalFiles() {
    if (currentTab !== 'local-files') {
        console.log('[Local Files] Tab switched, cancelling refresh');
        return;
    }
    
    if (localFilesLoading) {
        console.log('[Local Files] Already loading, skipping...');
        return;
    }
    
    try {
        localFilesLoading = true;
        
        const response = await window.electronAPI.getLocalFiles();
        
        if (currentTab !== 'local-files') {
            console.log('[Local Files] Tab switched during load, cancelling');
            return;
        }
        
        if (response.error) {
            showToast('error', 'Failed to load local files: ' + response.error);
            displayLocalFiles([]);
        } else {
            const files = response.files || [];
            
            localFilesData = files;
            currentLocalFilesPage = 1;
            
            displayLocalFilesPage(currentLocalFilesPage);
            updateLocalFilesPagination();
            updateStorageInfo();
        }
    } catch (error) {
        if (currentTab === 'local-files') {
        showToast('error', 'Failed to load local files: ' + error.message);
        displayLocalFiles([]);
        }
    } finally {
        localFilesLoading = false;
    }
}

function displayLocalFiles(files) {
    if (files.length === 0) {
        elements.localFilesList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-download"></i>
                <p>No local files found</p>
                <small>Files downloaded from the server will appear here</small>
            </div>
        `;
        return;
    }
    
    const filesHTML = files.map(file => `
        <div class="local-file-item" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #f0f0f0;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <i class="fas fa-file" style="color: #4CAF50;"></i>
                <div>
                    <div style="font-weight: 500;">${file.filename}</div>
                    <div style="font-size: 0.9rem; color: #666;">
                        ${Math.round((file.size || 0) / (1024 * 1024))} MB • 
                        Downloaded: ${file.downloadedAt ? new Date(file.downloadedAt).toLocaleDateString() : 'Unknown'}
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="openLocalFile('${file.filepath}')">
                    <i class="fas fa-folder-open"></i>
                </button>
                <button class="btn btn-danger" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="removeLocalFile('${file.filepath}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    elements.localFilesList.innerHTML = filesHTML;
}

function displayLocalFilesPage(page) {
    const startIndex = (page - 1) * LOCAL_FILES_PAGE_SIZE;
    const endIndex = startIndex + LOCAL_FILES_PAGE_SIZE;
    const pageData = localFilesData.slice(startIndex, endIndex);
    
    console.log(`[Local Files] Displaying page ${page}: items ${startIndex + 1}-${Math.min(endIndex, localFilesData.length)} of ${localFilesData.length}`);
    displayLocalFiles(pageData);
}

function updateLocalFilesPagination() {
    const totalPages = Math.ceil(localFilesData.length / LOCAL_FILES_PAGE_SIZE);
    const paginationContainer = document.getElementById('local-files-pagination');
    
    if (!paginationContainer) {
        console.warn('[Local Files] Pagination container not found');
        return;
    }
    
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const paginationHTML = `
        <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
            <button onclick="changeLocalFilesPage(${currentLocalFilesPage - 1})" 
                    ${currentLocalFilesPage <= 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentLocalFilesPage <= 1 ? '#f5f5f5' : '#fff'}; cursor: ${currentLocalFilesPage <= 1 ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            
            <span style="color: #666;">
                Page ${currentLocalFilesPage} of ${totalPages} 
                (${localFilesData.length} total files)
            </span>
            
            <button onclick="changeLocalFilesPage(${currentLocalFilesPage + 1})" 
                    ${currentLocalFilesPage >= totalPages ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentLocalFilesPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentLocalFilesPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

function changeLocalFilesPage(page) {
    const totalPages = Math.ceil(localFilesData.length / LOCAL_FILES_PAGE_SIZE);
    
    if (page < 1 || page > totalPages) {
        return;
    }
    
    currentLocalFilesPage = page;
    displayLocalFilesPage(page);
    updateLocalFilesPagination();
    
    const localFilesList = document.getElementById('localFilesList');
    if (localFilesList) {
        localFilesList.scrollTop = 0;
    }
}

async function downloadLocalFile(filepath) {
    try {
        const response = await window.electronAPI.apiGet('local/download', { filepath });
        if (response.error) {
            showToast('error', 'Download failed: ' + response.error);
        } else {
            showToast('success', 'Download started');
        }
    } catch (error) {
        showToast('error', 'Download failed: ' + error.message);
    }
}

async function removeLocalFile(filepath) {
    if (confirm(`Are you sure you want to remove ${filepath} from local storage?`)) {
        try {
            const response = await window.electronAPI.removeLocalFile(filepath);
            if (response.error) {
                showToast('error', 'Failed to remove local file: ' + response.error);
            } else {
                showToast('success', 'File removed from local storage');
                refreshLocalFiles();
                updateStorageInfo();
            }
        } catch (error) {
            showToast('error', 'Failed to remove local file: ' + error.message);
        }
    }
}

async function openLocalFile(filepath) {
    try {
        const localPath = await window.electronAPI.getLocalFilePath(filepath);
        if (localPath) {
            const result = await window.electronAPI.showFileInFolder(localPath);
            if (result.success) {
                showToast('success', 'File location opened');
            } else {
                showToast('error', 'Failed to open file location: ' + (result.error || 'Unknown error'));
            }
        } else {
            showToast('error', 'Could not find local file');
        }
    } catch (error) {
        showToast('error', 'Failed to open file location: ' + error.message);
    }
}



async function clearLocalStorage() {
    if (confirm('Are you sure you want to clear all local files and their metadata? This action cannot be undone.')) {
        try {
            const localFiles = await window.electronAPI.getLocalFiles();
            if (localFiles.files && localFiles.files.length > 0) {
                for (const file of localFiles.files) {
                    await window.electronAPI.removeLocalFile(file.filepath);
                }
                showToast('success', 'Local storage cleared successfully');
            } else {
                showToast('info', 'No local files to clear');
            }
            refreshLocalFiles();
            updateStorageInfo();
        } catch (error) {
            showToast('error', 'Failed to clear local storage: ' + error.message);
        }
    }
}

async function updateStorageInfo() {
    try {
        const response = await window.electronAPI.getLocalStorageInfo();
        if (response) {
            const totalSizeMB = Math.round((response.totalSize || 0) / (1024 * 1024));
            elements.storageInfo.innerHTML = `
                <div class="storage-details">
                    <div><strong>Local Path:</strong> ${response.localPath}</div>
                    <div><strong>Total Files:</strong> ${response.totalFiles || '0'}</div>
                    <div><strong>Total Size:</strong> ${totalSizeMB} MB</div>
                    <div><strong>Last Sync:</strong> ${response.lastSync ? new Date(response.lastSync).toLocaleString() : 'Never'}</div>
                </div>
            `;
        } else {
            elements.storageInfo.innerHTML = '<div class="error">Could not load local storage info.</div>';
        }
    } catch (error) {
        console.error('Failed to update storage info:', error);
        elements.storageInfo.innerHTML = '<div class="error">Could not load local storage info.</div>';
    }
}

let historyData = [];
let currentHistoryPage = 1;
const HISTORY_PAGE_SIZE = 20;
let historyLoading = false;

let allFilesData = [];
let filesData = [];
let currentFilesPage = 1;
const FILES_PAGE_SIZE = 25;
let filesLoading = false;

let localFilesData = [];
let currentLocalFilesPage = 1;
const LOCAL_FILES_PAGE_SIZE = 25;
let localFilesLoading = false;

async function refreshHistory() {
    if (currentTab !== 'history') {
        console.log('[History] Tab switched, cancelling refresh');
        return;
    }
    
    if (historyLoading) {
        console.log('[History] Already loading, skipping...');
        return;
    }
    
    try {
        historyLoading = true;
        console.log('[History] Refreshing history...');
        
        elements.historyList.innerHTML = `
            <div class="loading-state" style="text-align: center; padding: 2rem; color: #666;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                <p>Loading history...</p>
            </div>
        `;
        
        const localStats = await window.electronAPI.getLocalStats();
        
        if (currentTab !== 'history') {
            console.log('[History] Tab switched during load, cancelling');
            return;
        }
        
        const localFiles = await window.electronAPI.getLocalFiles();
        
        if (currentTab !== 'history') {
            console.log('[History] Tab switched during load, cancelling');
            return;
        }
        
        console.log('[History] Local stats:', localStats);
        console.log('[History] Local files:', localFiles);
        
        if (localStats && localFiles) {
            historyData = [];
            
            if (localStats.lastSync) {
                historyData.push({
                    type: 'sync',
                    message: `Sync Session #${localStats.syncCount}`,
                    timestamp: localStats.lastSync,
                    details: `${localFiles.totalCount || 0} files synced`
                });
            }
            
            if (localFiles.files && localFiles.files.length > 0) {
                const recentFiles = localFiles.files
                    .sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt))
                    .slice(0, 100); // Limit to last 100 downloads
                
                recentFiles.forEach(file => {
                    historyData.push({
                        type: 'download',
                        message: `Downloaded: ${file.filename}`,
                        timestamp: file.downloadedAt,
                        details: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                    });
                });
            }
            
            historyData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            console.log('[History] Created history data:', historyData.length, 'items');
            
            if (currentTab !== 'history') {
                console.log('[History] Tab switched before UI update, cancelling');
                return;
            }
            
            currentHistoryPage = 1;
            displayHistoryPage(currentHistoryPage);
            updateHistoryPagination();
        } else {
            console.log('[History] No local data available');
            historyData = [];
            currentHistoryPage = 1;
            displayHistory([]);
            updateHistoryPagination();
        }
    } catch (error) {
        if (currentTab === 'history') {
            console.error('Failed to load history:', error);
    showToast('error', 'Failed to load history: ' + error.message);
            historyData = [];
            currentHistoryPage = 1;
        displayHistory([]);
            updateHistoryPagination();
        }
    } finally {
        historyLoading = false;
    }
}

function displayHistoryPage(page) {
    const startIndex = (page - 1) * HISTORY_PAGE_SIZE;
    const endIndex = startIndex + HISTORY_PAGE_SIZE;
    const pageData = historyData.slice(startIndex, endIndex);
    
    console.log(`[History] Displaying page ${page}: items ${startIndex + 1}-${Math.min(endIndex, historyData.length)} of ${historyData.length}`);
    displayHistory(pageData);
}

function updateHistoryPagination() {
    const totalPages = Math.ceil(historyData.length / HISTORY_PAGE_SIZE);
    const paginationContainer = document.getElementById('history-pagination');
    
    if (!paginationContainer) {
        console.warn('[History] Pagination container not found');
        return;
    }
    
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const paginationHTML = `
        <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
            <button onclick="changeHistoryPage(${currentHistoryPage - 1})" 
                    ${currentHistoryPage <= 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentHistoryPage <= 1 ? '#f5f5f5' : '#fff'}; cursor: ${currentHistoryPage <= 1 ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            
            <span style="color: #666;">
                Page ${currentHistoryPage} of ${totalPages} 
                (${historyData.length} total items)
            </span>
            
            <button onclick="changeHistoryPage(${currentHistoryPage + 1})" 
                    ${currentHistoryPage >= totalPages ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentHistoryPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentHistoryPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

function changeHistoryPage(page) {
    const totalPages = Math.ceil(historyData.length / HISTORY_PAGE_SIZE);
    
    if (page < 1 || page > totalPages) {
        return;
    }
    
    currentHistoryPage = page;
    displayHistoryPage(page);
    updateHistoryPagination();
    
    const historyList = document.getElementById('historyList');
    if (historyList) {
        historyList.scrollTop = 0;
    }
}

function filterHistory(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        currentHistoryPage = 1;
        displayHistoryPage(currentHistoryPage);
        updateHistoryPagination();
        return;
    }
    
    const filteredData = historyData.filter(item => 
        item.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.details.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    const totalPages = Math.ceil(filteredData.length / HISTORY_PAGE_SIZE);
    currentHistoryPage = 1;
    
    if (filteredData.length === 0) {
        elements.historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No results found for "${searchTerm}"</p>
            </div>
        `;
        updateHistoryPagination();
        return;
    }
    
    const pageData = filteredData.slice(0, HISTORY_PAGE_SIZE);
    displayHistory(pageData);
    
    const paginationContainer = document.getElementById('history-pagination');
    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
        } else {
            paginationContainer.style.display = 'flex';
            paginationContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
                    <span style="color: #666;">
                        Found ${filteredData.length} results for "${searchTerm}"
                    </span>
                    <button onclick="changeHistoryPage(${currentHistoryPage + 1})" 
                            ${currentHistoryPage >= totalPages ? 'disabled' : ''} 
                            style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentHistoryPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentHistoryPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                        Next <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            `;
        }
    }
}

function displayHistory(history) {
    if (history.length === 0) {
        elements.historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <p>No history available</p>
                <small>Complete a sync to see history</small>
            </div>
        `;
        return;
    }
    
    const historyHTML = history.map(item => {
        const icon = item.type === 'sync' ? 'fa-sync-alt' : 'fa-download';
        const color = item.type === 'sync' ? '#4CAF50' : '#2196F3';
        const date = new Date(item.timestamp).toLocaleString();
        
        return `
        <div class="history-item" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #f0f0f0;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                    <i class="fas ${icon}" style="color: ${color};"></i>
                <div>
                        <div style="font-weight: 500;">${item.message}</div>
                        <div style="font-size: 0.9rem; color: #666;">${date}</div>
                        ${item.details ? `<div style="font-size: 0.8rem; color: #888;">${item.details}</div>` : ''}
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    elements.historyList.innerHTML = historyHTML;
}

function exportHistory() {
    showToast('info', 'Exporting history...');
}

function clearHistory() {
    if (confirm('Are you sure you want to clear all history?')) {
        elements.historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <p>History cleared</p>
            </div>
        `;
        showToast('success', 'History cleared');
    }
}

let transfersData = [];
let currentTransfersPage = 1;
const TRANSFERS_PAGE_SIZE = 25;
let transfersLoading = false;

async function refreshTransfers() {
    if (currentTab !== 'transfers') {
        console.log('[Transfers] Tab switched, cancelling refresh');
        return;
    }
    
    if (transfersLoading) {
        console.log('[Transfers] Already loading, skipping...');
        return;
    }
    
    try {
        transfersLoading = true;
        console.log('[Transfers] Refreshing transfers...');
        
        elements.transfersList.innerHTML = `
            <div class="loading-state" style="text-align: center; padding: 2rem; color: #666;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                <p>Loading transfers...</p>
            </div>
        `;
        
        const localFiles = await window.electronAPI.getLocalFiles();
        
        if (currentTab !== 'transfers') {
            console.log('[Transfers] Tab switched during load, cancelling');
            return;
        }
        
        console.log('[Transfers] Local files:', localFiles);
        
        if (localFiles && localFiles.files) {
            transfersData = localFiles.files.map(file => ({
                name: file.filename,
                filepath: file.filepath,
                size: file.size,
                downloadedAt: file.downloadedAt,
                status: 'completed',
                progress: 100
            }));
            
            transfersData.sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt));
            
            console.log('[Transfers] Created transfers data:', transfersData.length, 'items');
            
            if (currentTab !== 'transfers') {
                console.log('[Transfers] Tab switched before UI update, cancelling');
                return;
            }
            
            currentTransfersPage = 1;
            displayTransfersPage(currentTransfersPage);
            updateTransfersPagination();
        } else {
            console.log('[Transfers] No local files available');
            transfersData = [];
            currentTransfersPage = 1;
            displayTransfers([]);
            updateTransfersPagination();
        }
    } catch (error) {
        if (currentTab === 'transfers') {
            console.error('Failed to load transfers:', error);
    showToast('error', 'Failed to load transfers: ' + error.message);
            transfersData = [];
            currentTransfersPage = 1;
        displayTransfers([]);
            updateTransfersPagination();
        }
    } finally {
        transfersLoading = false;
    }
}

function displayTransfersPage(page) {
    const startIndex = (page - 1) * TRANSFERS_PAGE_SIZE;
    const endIndex = startIndex + TRANSFERS_PAGE_SIZE;
    const pageData = transfersData.slice(startIndex, endIndex);
    
    console.log(`[Transfers] Displaying page ${page}: items ${startIndex + 1}-${Math.min(endIndex, transfersData.length)} of ${transfersData.length}`);
    displayTransfers(pageData);
}

function updateTransfersPagination() {
    const totalPages = Math.ceil(transfersData.length / TRANSFERS_PAGE_SIZE);
    const paginationContainer = document.getElementById('transfers-pagination');
    
    if (!paginationContainer) {
        console.warn('[Transfers] Pagination container not found');
        return;
    }
    
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const paginationHTML = `
        <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
            <button onclick="changeTransfersPage(${currentTransfersPage - 1})" 
                    ${currentTransfersPage <= 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentTransfersPage <= 1 ? '#f5f5f5' : '#fff'}; cursor: ${currentTransfersPage <= 1 ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            
            <span style="color: #666;">
                Page ${currentTransfersPage} of ${totalPages} 
                (${transfersData.length} total items)
            </span>
            
            <button onclick="changeTransfersPage(${currentTransfersPage + 1})" 
                    ${currentTransfersPage >= totalPages ? 'disabled' : ''} 
                    style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentTransfersPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentTransfersPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

function changeTransfersPage(page) {
    const totalPages = Math.ceil(transfersData.length / TRANSFERS_PAGE_SIZE);
    
    if (page < 1 || page > totalPages) {
        return;
    }
    
    currentTransfersPage = page;
    displayTransfersPage(page);
    updateTransfersPagination();
    
    const transfersList = document.getElementById('transfersList');
    if (transfersList) {
        transfersList.scrollTop = 0;
    }
}

function filterTransfers(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        currentTransfersPage = 1;
        displayTransfersPage(currentTransfersPage);
        updateTransfersPagination();
        return;
    }
    
    const filteredData = transfersData.filter(transfer => 
        transfer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transfer.filepath.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    const totalPages = Math.ceil(filteredData.length / TRANSFERS_PAGE_SIZE);
    currentTransfersPage = 1;
    
    if (filteredData.length === 0) {
        elements.transfersList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No results found for "${searchTerm}"</p>
            </div>
        `;
        updateTransfersPagination();
        return;
    }
    
    const pageData = filteredData.slice(0, TRANSFERS_PAGE_SIZE);
    displayTransfers(pageData);
    
    const paginationContainer = document.getElementById('transfers-pagination');
    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
        } else {
            paginationContainer.style.display = 'flex';
            paginationContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1rem;">
                    <span style="color: #666;">
                        Found ${filteredData.length} results for "${searchTerm}"
                    </span>
                    <button onclick="changeTransfersPage(${currentTransfersPage + 1})" 
                            ${currentTransfersPage >= totalPages ? 'disabled' : ''} 
                            style="padding: 0.5rem 1rem; border: 1px solid #ddd; background: ${currentTransfersPage >= totalPages ? '#f5f5f5' : '#fff'}; cursor: ${currentTransfersPage >= totalPages ? 'not-allowed' : 'pointer'}; border-radius: 4px;">
                        Next <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            `;
        }
    }
}

function displayTransfers(transfers) {
    if (transfers.length === 0) {
        elements.transfersList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exchange-alt"></i>
                <p>No transfers available</p>
                <small>Complete a sync to see transfer history</small>
            </div>
        `;
        return;
    }
    
    const transfersHTML = transfers.map(transfer => {
        const date = new Date(transfer.downloadedAt).toLocaleString();
        const sizeMB = (transfer.size / (1024 * 1024)).toFixed(2);
        const statusIcon = transfer.status === 'completed' ? 'fa-check-circle' : 'fa-clock';
        const statusColor = transfer.status === 'completed' ? '#4CAF50' : '#FF9800';
        
        return `
        <div class="transfer-item" style="padding: 1rem; border-bottom: 1px solid #f0f0f0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                        <i class="fas fa-download" style="color: #2196F3;"></i>
                        <div>
                            <div style="font-weight: 500;">${transfer.name}</div>
                            <div style="font-size: 0.9rem; color: #666;">${transfer.filepath}</div>
                </div>
            </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.9rem; color: #666;">${sizeMB} MB</div>
                        <div style="font-size: 0.8rem; color: #888;">${date}</div>
            </div>
        </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fas ${statusIcon}" style="color: ${statusColor}; font-size: 0.9rem;"></i>
                        <span style="font-size: 0.9rem; color: #666; text-transform: capitalize;">${transfer.status}</span>
                    </div>
                    <div class="progress-bar" style="width: 100px; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                        <div class="progress-fill" style="height: 100%; background: linear-gradient(90deg, #4CAF50, #45a049); border-radius: 3px; width: ${transfer.progress}%; transition: width 0.3s ease;"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    elements.transfersList.innerHTML = transfersHTML;
}

function clearCompleted() {
    elements.transfersList.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exchange-alt"></i>
            <p>Completed transfers cleared</p>
        </div>
    `;
    showToast('success', 'Completed transfers cleared');
}

function exportTransfers() {
    showToast('info', 'Exporting transfers...');
}

async function loadSettings() {
    try {
        currentSettings = await window.electronAPI.getSettings();
        settingsBaseline = JSON.stringify(currentSettings);
        settingsDirty = false;
        updateUnsavedBadge();
        
        elements.startWithWindows.checked = currentSettings.startWithWindows;
        elements.minimizeToTray.checked = currentSettings.minimizeToTray;
        elements.showTrayNotifications.checked = currentSettings.showTrayNotifications;
        elements.autoSyncEnabled.checked = currentSettings.autoSyncEnabled;
        elements.autoSyncInterval.value = currentSettings.autoSyncInterval;
        
        elements.autoSyncInterval.disabled = !currentSettings.autoSyncEnabled;
        elements.maxTransfers.value = currentSettings.maxTransfers;
        elements.logLevel.value = currentSettings.logLevel;
        elements.serverUrl.value = currentSettings.serverUrl;
        
        await loadStoragePathInfo();
        
        await loadStartupStatus();
        
        selectedFolders = new Set(currentSettings.selectedFolders || []);
        
        scheduleAutoSync();
        
        if (currentSettings.lastActiveTab && currentSettings.lastActiveTab !== 'settings') {
            switchTab(currentSettings.lastActiveTab);
        }
        
        if (currentTab === 'settings') {
            await refreshAvailableFolders();
        }
        settingsBaseline = JSON.stringify(await window.electronAPI.getSettings());
        settingsDirty = false;
        updateUnsavedBadge();
        
    } catch (error) {
        showToast('error', 'Failed to load settings');
    }
}

async function loadStartupStatus() {
    try {
        const startupInfo = await window.electronAPI.getStartupStatus();
        
        if (startupInfo.error) {
            console.error('[Startup] Failed to get startup status:', startupInfo.error);
            document.getElementById('startupType').textContent = 'Error checking startup status';
            return;
        }
        
        try {
            const container = document.getElementById('startOnBootSetting');
            if (container) {
                const p = String(startupInfo.platform || '');
                if (p !== 'darwin' && p !== 'win32') {
                    container.style.display = 'none';
                } else {
                    container.style.display = '';
                }
            }
        } catch (_) {}

        const startupTypeElement = document.getElementById('startupType');
        if (startupTypeElement) {
            if (startupInfo.isSystemWide) {
                startupTypeElement.textContent = 'System-wide installation - affects all users';
                startupTypeElement.style.color = '#FF9800';
            } else {
                startupTypeElement.textContent = 'User-specific installation - affects current user only';
                startupTypeElement.style.color = '#4CAF50';
            }
        }
        
        console.log('[Startup] Startup status loaded:', startupInfo);
        
    } catch (error) {
        console.error('[Startup] Failed to load startup status:', error);
        const startupTypeElement = document.getElementById('startupType');
        if (startupTypeElement) {
            startupTypeElement.textContent = 'Error checking startup status';
            startupTypeElement.style.color = '#F44336';
        }
    }
}

async function loadStoragePathInfo() {
    try {
        const pathInfo = await window.electronAPI.getStoragePath();
        
        if (pathInfo.error) {
            throw new Error(pathInfo.error);
        }
        
        elements.storagePath.value = pathInfo.currentPath;
        
        elements.currentStorageLocation.textContent = pathInfo.currentPath;
        
        if (pathInfo.isCustom) {
            elements.installationType.textContent = 'Custom Path (User-defined)';
            elements.installationType.style.color = '#2196F3';
        } else {
            elements.installationType.textContent = pathInfo.currentPath.includes('ProgramData') || pathInfo.currentPath.includes('/var/lib') 
                ? 'System-wide Installation' 
                : 'User-specific Installation';
            elements.installationType.style.color = '#666';
        }
        
        elements.resetStoragePathBtn.disabled = !pathInfo.isCustom;
        elements.changeStoragePathBtn.disabled = false; // Always enable change button
        
        console.log('[Storage] Button states updated - reset disabled:', !pathInfo.isCustom, 'change enabled: true');
        
    } catch (error) {
        console.error('Failed to load storage path info:', error);
        elements.currentStorageLocation.textContent = 'Error loading path info';
        elements.installationType.textContent = 'Unknown';
    }
}

async function changeStoragePath() {
    try {
        console.log('[Storage] Starting storage path change...');
        const folderPath = await window.electronAPI.selectFolder();
        
        console.log('[Storage] Selected folder path:', folderPath);
        
        if (folderPath) {
            const confirmMessage = `Are you sure you want to change the storage path to:\n\n${folderPath}\n\nThis will update your settings and create the necessary directories.`;
            
            if (confirm(confirmMessage)) {
                console.log('[Storage] User confirmed path change, calling setStoragePath...');
                const result = await window.electronAPI.setStoragePath(folderPath);
                
                console.log('[Storage] setStoragePath result:', result);
                
                if (result.success) {
                    showToast('success', result.message);
                    await loadStoragePathInfo();
                    
                    if (currentTab === 'local-files') {
                        refreshLocalFiles();
                    }
                } else {
                    showToast('error', result.error);
                }
            } else {
                console.log('[Storage] User canceled path change confirmation');
            }
        } else {
            console.log('[Storage] No folder path selected');
        }
    } catch (error) {
        console.error('[Storage] Error in changeStoragePath:', error);
        showToast('error', 'Failed to change storage path: ' + error.message);
    }
}

async function resetStoragePath() {
    try {
        const confirmMessage = 'Are you sure you want to reset the storage path to the default location? This will remove your custom path setting.';
        
        if (confirm(confirmMessage)) {
            const result = await window.electronAPI.resetStoragePath();
            
            if (result.success) {
                showToast('success', result.message);
                await loadStoragePathInfo();
                
                if (currentTab === 'local-files') {
                    refreshLocalFiles();
                }
            } else {
                showToast('error', result.error);
            }
        }
    } catch (error) {
        showToast('error', 'Failed to reset storage path: ' + error.message);
    }
}



let availableFolders = [];
let selectedFolders = new Set();

function extractRootFolders(files) {
    const rootFolders = new Set();
    
    files.forEach(file => {
        const filepath = file.filepath || file.path || file.name || file.filename;
        if (filepath) {
            const rootFolder = filepath.split('/')[0].split('\\')[0];
            if (rootFolder && rootFolder.trim()) {
                rootFolders.add(rootFolder);
            }
        }
    });
    
    return Array.from(rootFolders).sort();
}

function shouldSyncFile(filepath) {
    if (selectedFolders.size === 0) {
        return true;
    }
    
    const rootFolder = filepath.split('/')[0].split('\\')[0];
    return selectedFolders.has(rootFolder);
}

function filterFilesBySelectedFolders(files) {
    if (selectedFolders.size === 0) {
        return files; // Sync all files if no folders selected
    }
    
    return files.filter(file => {
        const filepath = file.filepath || file.path || file.name || file.filename;
        return shouldSyncFile(filepath);
    });
}

async function refreshAvailableFolders() {
    try {
        elements.folderSelectionContainer.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading available folders...</p>
            </div>
        `;
        
        const files = await getAllFiles();
        availableFolders = extractRootFolders(files);
        
        const settings = await window.electronAPI.getSettings();
        selectedFolders = new Set(settings.selectedFolders || []);
        
        console.log('[Folders] Available folders:', availableFolders);
        console.log('[Folders] Selected folders from settings:', settings.selectedFolders);
        console.log('[Folders] Current selectedFolders Set:', Array.from(selectedFolders));
        
        displayFolderSelection();
        updateSelectedFoldersCount();
        
    } catch (error) {
        console.error('Failed to refresh folders:', error);
        elements.folderSelectionContainer.innerHTML = `
            <div style="color: #f44336; text-align: center; padding: 1rem;">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load folders: ${error.message}</p>
                <button onclick="refreshAvailableFolders()" class="btn btn-secondary" style="margin-top: 0.5rem;">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
        showToast('error', 'Failed to load folders: ' + error.message);
    }
}

function displayFolderSelection() {
    if (availableFolders.length === 0) {
        elements.folderSelectionContainer.innerHTML = `
            <div style="text-align: center; color: #666; padding: 1rem;">
                <i class="fas fa-folder-open"></i>
                <p>No folders found</p>
            </div>
        `;
        return;
    }
    
    const folderHtml = availableFolders.map(folder => {
        const isSelected = selectedFolders.has(folder);
        return `
            <div class="folder-selection-item ${isSelected ? 'selected' : ''}" onclick="toggleFolderCheckbox('${folder}')">
                <input type="checkbox" 
                       data-folder="${folder}" 
                       ${isSelected ? 'checked' : ''} 
                       onchange="toggleFolderSelection('${folder}', this.checked)"
                       onclick="event.stopPropagation()">
                <i class="fas fa-folder folder-icon"></i>
                <span class="folder-name">${folder}</span>
                <span class="folder-description">(Root folder - includes all subdirectories)</span>
            </div>
        `;
    }).join('');
    
    elements.folderSelectionContainer.innerHTML = folderHtml;
}

function toggleFolderSelection(folder, isSelected) {
    if (isSelected) {
        selectedFolders.add(folder);
    } else {
        selectedFolders.delete(folder);
    }
    
    updateSelectedFoldersCount();
    saveFolderSelection();
    
    const folderItem = document.querySelector(`[data-folder="${folder}"]`).closest('.folder-selection-item');
    if (folderItem) {
        if (isSelected) {
            folderItem.classList.add('selected');
        } else {
            folderItem.classList.remove('selected');
        }
    }
}

function toggleFolderCheckbox(folder) {
    const checkbox = document.querySelector(`input[data-folder="${folder}"]`);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleFolderSelection(folder, checkbox.checked);
    }
}

function selectAllFolders() {
    availableFolders.forEach(folder => {
        selectedFolders.add(folder);
    });
    displayFolderSelection();
    updateSelectedFoldersCount();
    saveFolderSelection();
    
}

function deselectAllFolders() {
    selectedFolders.clear();
    displayFolderSelection();
    updateSelectedFoldersCount();
    saveFolderSelection();
    
}

function updateSelectedFoldersCount() {
    const count = selectedFolders.size;
    const total = availableFolders.length;
    
    if (count === 0) {
        elements.selectedFoldersCount.textContent = 'No folders selected (will sync everything)';
        elements.selectedFoldersCount.style.color = '#FF9800';
    } else if (count === total) {
        elements.selectedFoldersCount.textContent = `All ${total} folders selected`;
        elements.selectedFoldersCount.style.color = '#4CAF50';
    } else {
        elements.selectedFoldersCount.textContent = `${count} of ${total} folders selected`;
        elements.selectedFoldersCount.style.color = '#2196F3';
    }
}

async function saveFolderSelection() {
    try {
        const settings = await window.electronAPI.getSettings();
        settings.selectedFolders = Array.from(selectedFolders);
        await window.electronAPI.saveSettings(settings);
        currentSettings = settings;
    } catch (error) {
        console.error('Failed to save folder selection:', error);
        showToast('error', 'Failed to save folder selection');
    }
}

async function saveSettings() {
    try {
        const latest = await window.electronAPI.getSettings();
        const settings = {
            startWithWindows: elements.startWithWindows.checked,
            minimizeToTray: elements.minimizeToTray.checked,
            showTrayNotifications: elements.showTrayNotifications.checked,
            autoSyncEnabled: elements.autoSyncEnabled.checked,
            autoSyncInterval: parseInt(elements.autoSyncInterval.value),
            maxTransfers: parseInt(elements.maxTransfers.value),
            logLevel: elements.logLevel.value,
            serverUrl: elements.serverUrl.value,
            selectedFolders: Array.from(selectedFolders),
            customStoragePath: latest.customStoragePath,
            lastActiveTab: currentTab
        };
        
        await window.electronAPI.saveSettings(settings);
        currentSettings = settings;
        settingsBaseline = JSON.stringify(currentSettings);
        settingsDirty = false;
        updateUnsavedBadge();
        
        await loadStoragePathInfo();
        
        await loadStartupStatus();
        
        showToast('success', 'Settings saved successfully');
        scheduleAutoSync();
    } catch (error) {
        showToast('error', 'Failed to save settings');
    }
}

async function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        elements.startWithWindows.checked = false;
        elements.minimizeToTray.checked = false;
        elements.showTrayNotifications.checked = true;
        elements.autoSyncEnabled.checked = true;
        elements.autoSyncInterval.value = '30';
        elements.maxTransfers.value = '3';
        elements.logLevel.value = 'info';
        elements.serverUrl.value = 'https://m.juicewrldapi.com';
        
        selectedFolders.clear();
        
        const resetSettings = {
            startWithWindows: false,
            minimizeToTray: false,
            showTrayNotifications: true,
            autoSyncEnabled: true,
            autoSyncInterval: 30,
            maxTransfers: 3,
            logLevel: 'info',
            serverUrl: 'https://m.juicewrldapi.com',
            selectedFolders: [],
            lastActiveTab: 'overview'
        };
        
        try {
            await window.electronAPI.saveSettings(resetSettings);
            currentSettings = resetSettings;
            
            updateSelectedFoldersCount();
            displayFolderSelection();
            
            await loadStartupStatus();
            
            showToast('success', 'Settings reset to defaults and saved');
        } catch (error) {
            showToast('error', 'Failed to save reset settings');
        }
    }
}


async function exportSettings() {
    try {
        const result = await window.electronAPI.exportSettings();
        
        if (result.success) {
            showToast('success', `Settings exported successfully to: ${result.filePath}`);
        } else if (result.canceled) {
        } else {
            showToast('error', 'Failed to export settings: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        showToast('error', 'Failed to export settings: ' + error.message);
    }
}


async function importSettings() {
    try {
        const result = await window.electronAPI.importSettings();
        
        if (result.success) {
            showToast('success', 'Settings imported successfully');
            
            await loadSettings();
            
            if (currentTab === 'settings') {
                await refreshAvailableFolders();
            }
        } else if (result.canceled) {
        } else {
            showToast('error', 'Failed to import settings: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        showToast('error', 'Failed to import settings: ' + error.message);
    }
}

async function downloadFile(filename) {
    try {
        const response = await window.electronAPI.apiGet('download', { filename });
        if (response.error) {
            showToast('error', 'Download failed: ' + response.error);
        } else {
            showToast('success', 'Download started');
        }
    } catch (error) {
        showToast('error', 'Download failed: ' + error.message);
    }
}

async function deleteFile(filename) {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
        try {
            const response = await window.electronAPI.apiPost('delete', { filename });
            if (response.error) {
                showToast('error', 'Delete failed: ' + response.error);
            } else {
                showToast('success', 'File deleted successfully');
                refreshFiles();
            }
        } catch (error) {
            showToast('error', 'Delete failed: ' + error.message);
        }
    }
}



function updateStatus(message) {
    elements.statusText.textContent = message;
}

function updateLastUpdate() {
    if (lastSuccessfulUpdate) {
        elements.lastUpdate.innerHTML = `<i class="fas fa-clock"></i> Last update: ${new Date(lastSuccessfulUpdate).toLocaleTimeString()}`;
    } else {
        elements.lastUpdate.innerHTML = `<i class="fas fa-clock"></i> Last update: Never`;
    }
}

async function updateStats() {
    try {
        console.log('[Stats] Updating stats...');
        
        const response = await window.electronAPI.apiGet('status/');
        console.log('[Stats] Server response:', response);
        if (response && !response.error && typeof response.total_files !== 'undefined') {
            elements.totalFiles.textContent = String(response.total_files);
            console.log('[Stats] Updated total files:', response.total_files);
        } else {
            elements.totalFiles.textContent = '?';
        }
        
        const localStats = await window.electronAPI.getLocalStats();
        console.log('[Stats] Local stats:', localStats);
        
        if (localStats) {
            elements.lastSync.textContent = localStats.lastSync ? new Date(localStats.lastSync).toLocaleString() : 'Never';
            elements.syncCount.textContent = localStats.syncCount || '0';
            console.log('[Stats] Updated last sync:', localStats.lastSync, 'sync count:', localStats.syncCount);
        }
        
        if (availableFolders.length > 0) {
            const selectedCount = selectedFolders.size;
            const totalCount = availableFolders.length;
            
            if (selectedCount === 0) {
                elements.syncCount.textContent = `${elements.syncCount.textContent} (All folders)`;
            } else if (selectedCount === totalCount) {
                elements.syncCount.textContent = `${elements.syncCount.textContent} (All folders)`;
            } else {
                elements.syncCount.textContent = `${elements.syncCount.textContent} (${selectedCount}/${totalCount} folders)`;
            }
        }
    } catch (error) {
        console.error('Failed to update stats:', error);
        elements.totalFiles.textContent = '?';
        elements.lastSync.textContent = 'Never';
        elements.syncCount.textContent = '0';
    }
}



function showToast(type, message) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
    
    toast.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;
    
    const container = document.getElementById('toastContainer');
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => container.removeChild(toast), 300);
    }, 3000);
}

function showDesktopNotification(title, body) {
    try {
        if (!('Notification' in window)) return;
        const isEnabled = !!(currentSettings && currentSettings.showTrayNotifications);
        if (!isEnabled) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then((perm) => {
                if (perm === 'granted') new Notification(title, { body });
            }).catch(() => {});
        }
    } catch (_) {}
}

async function downloadToLocal(filepath) {
    try {
        const serverUrl = currentSettings.serverUrl || 'http://localhost:8000';
        showToast('info', `Downloading ${filepath} to local storage...`);
        
        const response = await window.electronAPI.downloadFileToLocal(filepath, serverUrl, null);
        
        if (response.success) {
            if (response.alreadyExists) {
                showToast('info', response.message);
            } else {
                showToast('success', `${filepath} downloaded successfully!`);
            }
            if (document.getElementById('local-files').classList.contains('active')) {
                refreshLocalFiles();
                updateStorageInfo();
            }
        } else {
            showToast('error', 'Download failed: ' + (response.error || 'Unknown error'));
        }
    } catch (error) {
        showToast('error', 'Download failed: ' + error.message);
    }
}

function closeDownloadProgress() {
    const progress = document.getElementById('download-progress');
    if (progress) {
        progress.remove();
    }
}

setInterval(updateLastUpdate, 30000);

setInterval(updateStats, 60000);

async function testLocalFilesAPI() {
    try {
        console.log('[Test] Testing getLocalFiles API...');
        
        const response = await window.electronAPI.getLocalFiles();
        console.log('[Test] Raw response:', response);
        
        if (response.error) {
            console.error('[Test] API returned error:', response.error);
            return;
        }
        
        const files = response.files || [];
        console.log('[Test] Files array length:', files.length);
        
        if (files.length > 0) {
            console.log('[Test] First file structure:', files[0]);
            console.log('[Test] File properties:', Object.keys(files[0]));
            
            const hasFilepath = files.some(f => f.filepath);
            const hasPath = files.some(f => f.path);
            const hasFilename = files.some(f => f.filename);
            
            console.log('[Test] Has filepath property:', hasFilepath);
            console.log('[Test] Has path property:', hasPath);
            console.log('[Test] Has filename property:', hasFilename);
        } else {
            console.log('[Test] No files returned');
        }
        
        if (files.length > 0) {
            const sampleFile = files[0];
            const filepath = sampleFile.filepath || sampleFile.path;
            if (filepath) {
                console.log('[Test] Testing getLocalFilePath for:', filepath);
                const localPath = await window.electronAPI.getLocalFilePath(filepath);
                console.log('[Test] Local path result:', localPath);
            }
        }
        
    } catch (error) {
        console.error('[Test] Error testing API:', error);
    }
}

async function downloadAllFiles() {
    try {
        if (!Array.isArray(filesData) || filesData.length === 0) {
            showToast('info', 'No files to download');
            return;
        }
        const serverUrl = currentSettings.serverUrl || 'http://localhost:8000';
        syncInProgress = true;
        updateSyncStatus('syncing', 0);
        let completed = 0;
        const total = filesData.length;
        for (const file of filesData) {
            const fp = file.filepath || file.path || file.name || file.filename;
            if (fp) {
                try {
                    await window.electronAPI.downloadFileToLocal(fp, serverUrl, null);
                } catch (e) {}
            }
            completed += 1;
            const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
            updateSyncStatus('syncing', pct);
        }
        syncInProgress = false;
        updateSyncStatus('ready');
        showToast('success', 'All files processed');
        if (document.getElementById('local-files').classList.contains('active')) {
            refreshLocalFiles();
            updateStorageInfo();
        }
    } catch (error) {
        syncInProgress = false;
        updateSyncStatus('error');
        showToast('error', 'Download all failed');
    }
}


function bindTransferEvents() {
    const activeTransfers = new Map();

    function upsertTransfer(fp, partial) {
        const existing = activeTransfers.get(fp) || {
            name: fp.split('/').pop(),
            filepath: fp,
            size: 0,
            downloadedAt: new Date().toISOString(),
            status: 'in-progress',
            progress: 0
        };
        const updated = { ...existing, ...partial };
        activeTransfers.set(fp, updated);
        const others = transfersData.filter(t => t.filepath !== fp);
        transfersData = [updated, ...others];
        if (currentTab === 'transfers') {
            transfersData.sort((a, b) => (b.status === 'in-progress') - (a.status === 'in-progress'));
            currentTransfersPage = 1;
            displayTransfersPage(currentTransfersPage);
            updateTransfersPagination();
        }
    }

    window.electronAPI.onTransferStart((data) => {
        upsertTransfer(data.filepath, { name: data.name || data.filepath.split('/').pop(), status: 'in-progress', progress: 0 });
    });

    window.electronAPI.onTransferProgress((data) => {
        let progress = 0;
        if (data.total && data.total > 0) {
            progress = Math.max(0, Math.min(100, Math.round((data.downloaded / data.total) * 100)));
        }
        upsertTransfer(data.filepath, { status: 'in-progress', progress });
    });

    window.electronAPI.onTransferComplete((data) => {
        upsertTransfer(data.filepath, { status: 'completed', progress: 100, size: data.size || 0, downloadedAt: new Date().toISOString() });
    });

    window.electronAPI.onTransferError((data) => {
        upsertTransfer(data.filepath, { status: 'error', progress: 0 });
    });
}

try { bindTransferEvents(); } catch (e) { console.error('[Transfers] Bind events failed:', e); }

function scheduleAutoSync() {
    try {
        if (autoSyncTimer) {
            clearInterval(autoSyncTimer);
            autoSyncTimer = null;
        }
        if (!currentSettings || !currentSettings.autoSyncEnabled) {
            console.log('[AutoSync] Disabled');
            return;
        }
        const minutes = Math.max(1, parseInt(currentSettings.autoSyncInterval || 30));
        const intervalMs = minutes * 60 * 1000;
        console.log(`[AutoSync] Enabled: every ${minutes} minute(s)`);
        autoSyncTimer = setInterval(async () => {
            if (syncInProgress) {
                console.log('[AutoSync] Skipping (sync already in progress)');
                return;
            }
            if (!serverConnected) {
                console.log('[AutoSync] Skipping (server not connected)');
                return;
            }
            try {
                console.log('[AutoSync] Starting scheduled sync');
                await startSyncOptimized();
            } catch (e) {
                console.log('[AutoSync] Scheduled sync failed');
            }
        }, intervalMs);
    } catch (e) {
        console.error('[AutoSync] Failed to schedule:', e);
    }
}

async function* runSyncWorker() {
    try {
        yield { type: 'status', message: 'Checking for updates...', progress: 5 };
        
        const localStats = await window.electronAPI.getLocalStats();
        let commitsEndpoint = 'commits';
        if (localStats && localStats.lastSync) {
            const lastSyncDate = new Date(localStats.lastSync);
            const timestamp = lastSyncDate.toISOString();
            commitsEndpoint = `commits?since_timestamp=${encodeURIComponent(timestamp)}`;
        }
        
        const commitsResponse = await window.electronAPI.apiGet(commitsEndpoint);
        if (commitsResponse.error) {
            throw new Error('Failed to get commits: ' + commitsResponse.error);
        }
        
        let commits = [];
        if (Array.isArray(commitsResponse)) commits = commitsResponse;
        else if (commitsResponse && Array.isArray(commitsResponse.commits)) commits = commitsResponse.commits;
        else if (commitsResponse && Array.isArray(commitsResponse.data)) commits = commitsResponse.data;
        
        const baselineFullSync = !localStats || !localStats.totalFiles || localStats.totalFiles === 0;
        const hasCommits = commits.length > 0;
        let deletedCount = 0; // ensure defined for progress accounting
        
        const extractOpsFromCommit = (c)=>{
            const updates = []
            const deletes = []
            if (!c || typeof c !== 'object') return { updates, deletes }
            const candidates = [
                c.files, c.paths, c.changed_files, c.changedFiles, c.items,
                c.diffs, c.diff, c.changes, c.delta, c.modified, c.added,
                c.removed, c.deleted, c.delete
            ]
            for (const arr of candidates) {
                if (!arr) continue
                if (Array.isArray(arr)) {
                    for (const it of arr) {
                        if (typeof it === 'string') updates.push(it)
                        else if (it && typeof it === 'object') {
                            const statusRaw = (it.action || it.operation || it.op || it.type || it.status || '').toString().toLowerCase()
                            const isDelete = it.deleted === true || it.removed === true || statusRaw === 'delete' || statusRaw === 'removed' || statusRaw === 'remove' || statusRaw === 'del' || statusRaw === 'deletion' || statusRaw === 'deleted'
                            const p = it.old_path || it.previous_path || it.filepath || it.path || it.name || it.filename || it.new_path
                            if (typeof p === 'string') { if (isDelete) deletes.push(p); else updates.push(p) }
                        }
                    }
                }
            }
            const tp = c.filepath || c.path || c.filename
            if (typeof tp === 'string') {
                const statusRaw = (c.action || c.operation || c.op || c.type || c.status || '').toString().toLowerCase()
                const isDeleteTop = c.deleted === true || c.removed === true || statusRaw === 'delete' || statusRaw === 'removed' || statusRaw === 'remove' || statusRaw === 'del' || statusRaw === 'deletion' || statusRaw === 'deleted'
                if (isDeleteTop) deletes.push(tp); else updates.push(tp)
            }
            return { updates: Array.from(new Set(updates)), deletes: Array.from(new Set(deletes)) }
        }
        
        let changedPaths = []
        let deletePaths = []
        for (const commit of commits) {
            const ops = extractOpsFromCommit(commit)
            if (ops && ops.updates) changedPaths = changedPaths.concat(ops.updates)
            if (ops && ops.deletes) deletePaths = deletePaths.concat(ops.deletes)
        }
        changedPaths = Array.from(new Set(changedPaths.filter(p => typeof p === 'string' && p)))
        deletePaths = Array.from(new Set(deletePaths.filter(p => typeof p === 'string' && p)))
        
        const hasFolderSelection = selectedFolders && selectedFolders.size > 0
        const pathMatchesSelection = (p)=>{ try { const root = String(p).split('/')[0].split('\\')[0]; return !hasFolderSelection || selectedFolders.has(root) } catch (_) { return true } }
        const normalizeRel = (p)=>{ if (typeof p !== 'string') return ''; let r = p.replace(/\\/g, '/').replace(/^\/+/, ''); return r }
        const toSyncPaths = changedPaths.map(normalizeRel).filter(Boolean).filter(pathMatchesSelection)
        const toDeletePaths = deletePaths.map(normalizeRel).filter(Boolean).filter(pathMatchesSelection)
        
        let files = []
        let useDirectPaths = false
        if (!hasCommits && !baselineFullSync) {
            yield { type: 'status', message: 'No new commits. Verifying library completeness...', progress: 10 }
            const allFiles = await getAllFiles()
            const selected = filterFilesBySelectedFolders(allFiles)
            if ((localStats && (localStats.totalFiles||0)) >= selected.length) {
                yield { type: 'complete', message: 'No updates available', downloaded: 0, updated: 0, skipped: 0, errors: 0 }
                return
            }
            try {
                const localRes = await window.electronAPI.getLocalFiles();
                const localSet = new Set((localRes && Array.isArray(localRes.files) ? localRes.files : []).map(f => f.filepath));
                files = selected.filter(f => !localSet.has(f.filepath || f.path));
            } catch (_) {
                files = selected;
            }
        }
        
        if (toDeletePaths.length > 0) {
            let deletedCount = 0
            let deleteErrors = 0
            const totalDel = toDeletePaths.length
            for (let i = 0; i < totalDel; i++) {
                if (syncCancelled) return
                const fp = toDeletePaths[i]
                const normalizedPath = normalizeRel(fp)
                try {
                    const res = await window.electronAPI.removeLocalFile(normalizedPath)
                    if (res && res.success) deletedCount += 1; else deleteErrors += 1
                } catch (_) { deleteErrors += 1 }
                const delProgress = Math.min(15, Math.round(((i+1) / totalDel) * 15))
                yield { type: 'progress', message: `Deleting... ${i+1}/${totalDel}`, progress: delProgress, downloaded: 0, updated: 0, skipped: 0, errors: deleteErrors, deleted: deletedCount }
            }
            if (!hasCommits && files.length === 0) {
                yield { type: 'status', message: 'Refreshing data...', progress: 98 }
                await updateStats()
                const totalProcessed = deletedCount + 0
                yield { type: 'complete', message: `Sync complete! Processed ${totalProcessed} files`, downloaded: 0, updated: 0, skipped: 0, errors: 0, deleted: deletedCount }
                return
            }
        }
        
        if (files.length === 0) {
            if (toSyncPaths.length > 0) {
                files = toSyncPaths.map(p => ({ filepath: p }))
                useDirectPaths = true
                yield { type: 'status', message: `Found ${files.length} changed file(s)`, progress: 15 }
            } else {
                yield { type: 'status', message: 'Getting file list...', progress: 10 }
                const allFiles = await getAllFiles()
                if (allFiles.length === 0) {
                    yield { type: 'complete', message: 'No files to sync', downloaded: 0, updated: 0, skipped: 0, errors: 0 }
                    return
                }
                let selected = filterFilesBySelectedFolders(allFiles)
                try {
                    const localRes = await window.electronAPI.getLocalFiles();
                    const localSet = new Set((localRes && Array.isArray(localRes.files) ? localRes.files : []).map(f => f.filepath));
                    files = selected.filter(f => !localSet.has(f.filepath || f.path));
                } catch (_) {
                    files = selected;
                }
                if (files.length === 0) {
                    yield { type: 'complete', message: 'No new files to download', downloaded: 0, updated: 0, skipped: 0, errors: 0 }
                    return
                }
                yield { type: 'status', message: `Found ${files.length} files to sync`, progress: 15 }
            }
        }
        
        let downloadedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        const serverUrl = currentSettings.serverUrl || 'http://localhost:8000';
        const maxConcurrent = Math.max(1, parseInt((currentSettings && currentSettings.maxTransfers) || 3) || 3);
        let maxPasses = 5;
        while (true) {
            const totalFiles = files.length;
            if (totalFiles === 0) break;
            let passDownloaded = 0;
            let passFailed = 0;
            let passSkipped = 0;
            let passUpdated = 0;
            let processed = 0;
            let index = 0;
            let active = [];
            let taskSeq = 0;

            const startNext = () => {
                if (index >= totalFiles || syncCancelled) return;
                const file = files[index++];
                const id = taskSeq++;
                const p = (async () => {
                    if (syncCancelled) return;
                    const fileName = file.filename || file.name || file.filepath || 'Unknown';
                    try {
                        const result = await window.electronAPI.downloadFileToLocal(
                            file.filepath || file.path,
                            serverUrl,
                            useDirectPaths ? null : files
                        );
                        if (result && result.success) {
                            if (result.alreadyExists) {
                                if (result.upToDate) { passSkipped++; skippedCount++; } else { passUpdated++; updatedCount++; }
                            } else {
                                passDownloaded++; downloadedCount++;
                            }
                        } else {
                            passFailed++; failedCount++;
                            console.error(`[Sync] Failed to download: ${fileName} - ${result ? result.error : 'Unknown error'}`);
                        }
                    } catch (error) {
                        passFailed++; failedCount++;
                        console.error(`[Sync] Error downloading file ${fileName}:`, error);
                    }
                    return id;
                })().catch(() => id);
                active.push({ id, p });
            };

            while (active.length < maxConcurrent && index < totalFiles && !syncCancelled) startNext();

            while (active.length > 0) {
                if (syncCancelled) return;
                try {
                    const finishedId = await Promise.race(active.map(a => a.p));
                    active = active.filter(a => a.id !== finishedId);
                } catch (_) {}
                processed += 1;
                const progress = Math.round((processed / totalFiles) * 80) + 15;
                yield { type: 'progress', message: `Syncing... ${processed}/${totalFiles} files`, progress, downloaded: passDownloaded, updated: passUpdated, skipped: passSkipped, errors: passFailed, deleted: deletedCount, total: totalFiles };
                await new Promise(resolve => setTimeout(resolve, 50));
                while (active.length < maxConcurrent && index < totalFiles && !syncCancelled) startNext();
            }
            if (useDirectPaths) break;
            if (--maxPasses <= 0) break;
            try {
                const localRes = await window.electronAPI.getLocalFiles();
                const localSet = new Set((localRes && Array.isArray(localRes.files) ? localRes.files : []).map(f => f.filepath));
                const allFiles = await getAllFiles();
                const selected = filterFilesBySelectedFolders(allFiles);
                const remaining = selected.filter(f => !localSet.has(f.filepath || f.path));
                if (remaining.length === 0) break;
                files = remaining;
                yield { type: 'status', message: `Continuing: ${files.length} remaining`, progress: 15 };
            } catch (_) {
                break;
            }
        }
        
        if (syncCancelled) return;
        
        yield { type: 'status', message: 'Updating sync stats...', progress: 95 };
        
        let lastCommitId = null;
        if (commits.length > 0) {
            const latestCommit = commits.reduce((latest, current) => {
                const currentTime = new Date(current.timestamp || current.created_at || 0).getTime();
                const latestTime = new Date(latest.timestamp || latest.created_at || 0).getTime();
                return currentTime > latestTime ? current : latest;
            });
            lastCommitId = latestCommit.id || latestCommit.commit_id || latestCommit.hash;
        }
        
        await window.electronAPI.updateSyncStats(lastCommitId);
        
        yield { type: 'status', message: 'Refreshing data...', progress: 98 };
        if (downloadedCount > 0 || updatedCount > 0) {
            await refreshFiles();
        }
        await updateStats();
        
        const totalProcessed = downloadedCount + updatedCount + skippedCount + failedCount + deletedCount;
        yield { 
            type: 'complete', 
            message: `Sync complete! Processed ${totalProcessed} files`, 
            downloaded: downloadedCount,
            updated: updatedCount,
            skipped: skippedCount,
            errors: failedCount,
            deleted: deletedCount
        };
        
    } catch (error) {
        yield { type: 'error', message: 'Sync failed: ' + error.message, error: error };
    }
}

async function startSyncOptimized() {
    if (syncInProgress) {
        cancelSync();
        return;
    }
    
    syncInProgress = true;
    syncCancelled = false;
    elements.syncBtn.disabled = true;
    elements.syncBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Sync';
    
    updateSyncStatus('syncing');
    showProgress();
    updateStatus('Starting sync...');
    showDesktopNotification('Sync started', 'Sync & download has begun');
    
    try {
        const progressContainer = document.createElement('div');
        progressContainer.id = 'download-progress';
        progressContainer.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 400px; 
            background: white; border: 1px solid #ddd; border-radius: 8px; 
            padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000;
        `;
        progressContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; color: #333;">Download Progress</h4>
                <button id="cancel-download" style="background: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">Cancel</button>
            </div>
            <div style="background: #f0f0f0; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
                <div id="download-progress-fill" style="background: #4CAF50; height: 100%; width: 0%; transition: width 0.3s ease;"></div>
            </div>
            <div id="download-progress-text" style="font-size: 14px; color: #666;">Starting sync...</div>
        `;
        
        document.body.appendChild(progressContainer);
        
        document.getElementById('cancel-download').addEventListener('click', () => {
            cancelSync();
        });
        
        const worker = runSyncWorker();
        let result = await worker.next();
        
        while (!result.done) {
            const data = result.value;
            
            switch (data.type) {
                case 'status':
                    updateStatus(data.message);
                    try { await window.electronAPI.appendJobLog(`[STATUS] ${data.message}`) } catch (_) {}
                    break;
                    
                case 'progress':
                    const progressBar = document.getElementById('sync-progress');
                    if (progressBar) {
                        progressBar.style.width = `${data.progress}%`;
                    }
                    updateStatus(data.message);
                    try { await window.electronAPI.appendJobLog(`[PROGRESS] ${data.progress}% ${data.message} (d:${Number(data.downloaded||0)} u:${Number(data.updated||0)} s:${Number(data.skipped||0)} e:${Number(data.errors||0)} del:${Number(data.deleted||0)})`) } catch (_) {}
                    
                    const progressFill = document.getElementById('download-progress-fill');
                    const progressText = document.getElementById('download-progress-text');
                    
                    if (progressFill) {
                        progressFill.style.width = `${data.progress}%`;
                    }
                    if (progressText) {
                        progressText.textContent = `${data.message} (${data.downloaded} downloaded, ${data.updated} updated, ${data.skipped} skipped, ${data.errors} failed)`;
                    }
                    break;
                    
                case 'complete':
                    updateStatus(data.message);
                    updateSyncStatus('ready');
                    hideProgress();
                    
                    if (progressContainer.parentNode) {
                        progressContainer.parentNode.removeChild(progressContainer);
                    }
                    
                    try { await window.electronAPI.notifySyncComplete() } catch (_) {}

                    const d = Number(data.downloaded||0)
                    const u = Number(data.updated||0)
                    const s = Number(data.skipped||0)
                    const e = Number(data.errors||0)
                    const processedTotal = d + u + s + e
                    try { await window.electronAPI.appendJobLog(`[COMPLETE] ${processedTotal} processed (d:${d} u:${u} s:${s} e:${e} del:${Number(data.deleted||0)})`) } catch (_) {}
                    if (e > 0) {
                        showToast('warning', `Sync completed with ${e} errors. Processed ${processedTotal} files.`);
                        showDesktopNotification('Sync completed with errors', `${processedTotal} processed, ${e} errors`);
                    } else {
                        showToast('success', `Sync completed successfully! Processed ${processedTotal} files.`);
                        showDesktopNotification('Sync completed', `${processedTotal} files processed successfully`);
                    }
                    break;
                    
                case 'error':
                    try { await window.electronAPI.appendJobLog(`[ERROR] ${data.message}`) } catch (_) {}
                    throw new Error(data.message);
            }
            
            result = await worker.next();
        }
        
    } catch (error) {
        console.error('[Sync] Sync failed:', error);
        showToast('error', 'Sync failed: ' + error.message);
        updateStatus('Sync failed');
        updateSyncStatus('error');
        hideProgress();
        
        const downloadProgress = document.getElementById('download-progress');
        if (downloadProgress) {
            downloadProgress.remove();
        }
    } finally {
        syncInProgress = false;
        syncCancelled = false;
        elements.syncBtn.disabled = false;
        elements.syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync & Download';
    }
}

const AUTH_STORAGE_KEY = 'authData';
async function getServerUrl(){
    try{
        const s = await window.electronAPI.getSettings();
        const u = (s && s.serverUrl) ? String(s.serverUrl).trim() : 'https://m.juicewrldapi.com';
        return u.endsWith('/') ? u.slice(0,-1) : u;
    }catch(_){ return 'https://m.juicewrldapi.com'; }
}
let roomsWS = null;
let currentRoom = null;
let authState = {
    isAuthenticated: false,
    username: null,
    deviceId: null,
    token: null,
    role: null,
    createdAt: null
};

let lastRoomsTs = 0;
let pairingCodeTimer = null;
let accountTabInitialized = false;

async function initializeAccountTab() {
    if (accountTabInitialized) {
        await updateAccountUI();
        return;
    }
    try {
        await loadAuthState();
        setupAccountEventListeners();
        await updateAccountUI();
        accountTabInitialized = true;
    } catch (error) {
        console.error('[Account] Initialization failed:', error);
        showToast('error', 'Failed to initialize account tab');
    }
}

async function loadAuthState() {
    try {
        const settings = await window.electronAPI.getSettings();
        if (settings && settings.authData) {
            authState = {
                isAuthenticated: true,
                username: settings.authData.username || null,
                deviceId: settings.authData.deviceId || null,
                token: settings.authData.token || null,
                role: settings.authData.role || 'user',
                createdAt: settings.authData.createdAt || null
            };
        }
    } catch (error) {
        console.error('[Account] Failed to load auth state:', error);
        authState = {
            isAuthenticated: false,
            username: null,
            deviceId: null,
            token: null,
            role: null,
            createdAt: null
        };
    }
}

async function saveAuthState() {
    try {
        const settings = await window.electronAPI.getSettings();
        settings.authData = {
            username: authState.username,
            deviceId: authState.deviceId,
            token: authState.token,
            role: authState.role,
            createdAt: authState.createdAt
        };
        await window.electronAPI.saveSettings(settings);
    } catch (error) {
        console.error('[Account] Failed to save auth state:', error);
        throw error;
    }
}

async function clearAuthState() {
    try {
        authState = {
            isAuthenticated: false,
            username: null,
            deviceId: null,
            token: null,
            role: null,
            createdAt: null
        };
        const settings = await window.electronAPI.getSettings();
        delete settings.authData;
        await window.electronAPI.saveSettings(settings);
    } catch (error) {
        console.error('[Account] Failed to clear auth state:', error);
        throw error;
    }
}

function setupAccountEventListeners() {
    const createAccountForm = document.getElementById('createAccountForm');
    if (createAccountForm) {
        createAccountForm.addEventListener('submit', handleCreateAccount);
    }

    const pairDeviceForm = document.getElementById('pairDeviceForm');
    if (pairDeviceForm) {
        pairDeviceForm.addEventListener('submit', handlePairDevice);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    const refreshAccountBtn = document.getElementById('refreshAccountBtn');
    if (refreshAccountBtn) {
        refreshAccountBtn.addEventListener('click', handleRefreshAccount);
    }

    const revokeDeviceBtn = document.getElementById('revokeDeviceBtn');
    if (revokeDeviceBtn) {
        revokeDeviceBtn.addEventListener('click', handleRevokeDevice);
    }

    const generatePairingCodeBtn = document.getElementById('generatePairingCodeBtn');
    if (generatePairingCodeBtn) {
        generatePairingCodeBtn.addEventListener('click', handleGeneratePairingCode);
    }

    const copyPairingCodeBtn = document.getElementById('copyPairingCodeBtn');
    if (copyPairingCodeBtn) {
        copyPairingCodeBtn.addEventListener('click', handleCopyPairingCode);
    }
}

async function updateAccountUI() {
    const accountNotAuth = document.getElementById('accountNotAuth');
    const accountAuth = document.getElementById('accountAuth');
    const accountLoading = document.getElementById('accountLoading');
    const accountActions = document.getElementById('accountActions');

    try {
        accountLoading.style.display = 'block';
        accountNotAuth.style.display = 'none';
        accountAuth.style.display = 'none';

        if (authState.isAuthenticated && authState.token) {
            const statusResponse = await makeAuthRequest('/auth/status', 'GET');
            
            if (statusResponse.error) {
                console.warn('[Account] Auth check failed, clearing state:', statusResponse.error);
                await clearAuthState();
                showNotAuthenticatedView();
            } else {
                authState.username = statusResponse.username || authState.username;
                authState.deviceId = statusResponse.device_id || authState.deviceId;
                authState.role = statusResponse.role || authState.role;
                showAuthenticatedView(statusResponse);
                accountActions.style.display = 'flex';
            }
        } else {
            showNotAuthenticatedView();
        }
    } catch (error) {
        console.error('[Account] Failed to update UI:', error);
        showNotAuthenticatedView();
    } finally {
        accountLoading.style.display = 'none';
    }
}

function showNotAuthenticatedView() {
    const accountNotAuth = document.getElementById('accountNotAuth');
    const accountAuth = document.getElementById('accountAuth');
    const accountActions = document.getElementById('accountActions');
    
    accountNotAuth.style.display = 'block';
    accountAuth.style.display = 'none';
    accountActions.style.display = 'none';
}

function showAuthenticatedView(userData) {
    const accountNotAuth = document.getElementById('accountNotAuth');
    const accountAuth = document.getElementById('accountAuth');
    const accountActions = document.getElementById('accountActions');
    
    accountNotAuth.style.display = 'none';
    accountAuth.style.display = 'block';
    accountActions.style.display = 'flex';

    document.getElementById('accountUsername').textContent = userData.username || authState.username || 'Unknown';
    document.getElementById('accountDeviceId').textContent = userData.device_id || authState.deviceId || 'N/A';
    document.getElementById('accountRole').textContent = (userData.role || authState.role || 'user').toUpperCase();
    
    const createdDate = userData.created_at || authState.createdAt;
    if (createdDate) {
        try {
            const date = new Date(createdDate);
            document.getElementById('accountCreated').textContent = date.toLocaleDateString();
        } catch (e) {
            document.getElementById('accountCreated').textContent = 'Unknown';
        }
    } else {
        document.getElementById('accountCreated').textContent = 'Unknown';
    }

    const accountOwnerSection = document.getElementById('accountOwnerSection');
    if (userData.is_owner || authState.role === 'owner') {
        accountOwnerSection.style.display = 'block';
    } else {
        accountOwnerSection.style.display = 'none';
    }
}

async function handleCreateAccount(event) {
    try {
        event.preventDefault();
        
        const username = document.getElementById('newUsername').value.trim();
        const deviceName = document.getElementById('newDeviceName').value.trim() || 'Desktop';

        if (!username) {
            showToast('error', 'Please enter a username');
            return;
        }

        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            showToast('error', 'Username must be 3-30 characters (letters, numbers, underscores only)');
            return;
        }

        const submitBtn = event.target.querySelector('button[type="submit"]');
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

        try {
        const claimResponse = await makeAuthRequest('/auth/claim-token', 'POST', {
            username: username
        });

        console.log('[Account] Claim response:', claimResponse);

        if (claimResponse.error) {
            throw new Error(claimResponse.error);
        }

        if (!claimResponse.token) {
            console.error('[Account] No token in response:', claimResponse);
            throw new Error('Server did not return a claim token');
        }

        const claimToken = claimResponse.token;
        console.log('[Account] Claim token received:', claimToken);
        
        const requestBody = {
            token: claimToken,
            device_name: deviceName
        };
        console.log('[Account] Redeem request body:', requestBody);
        
        const redeemResponse = await makeAuthRequest('/auth/redeem-claim', 'POST', requestBody);

        console.log('[Account] Redeem response:', JSON.stringify(redeemResponse, null, 2));

        if (redeemResponse.error) {
            throw new Error(redeemResponse.error);
        }

        authState = {
            isAuthenticated: true,
            username: username,
            deviceId: redeemResponse.device?.device_id || redeemResponse.device_id || redeemResponse.deviceId,
            token: redeemResponse.refresh_token || redeemResponse.token,
            role: 'owner',
            createdAt: new Date().toISOString()
        };

        console.log('[Account] Setting authState:', JSON.stringify(authState, null, 2));

        await saveAuthState();
        console.log('[Account] Auth state saved');
        
        const verifySettings = await window.electronAPI.getSettings();
        console.log('[Account] Verified saved authData:', JSON.stringify(verifySettings.authData, null, 2));
        console.log('[Account] Full settings:', JSON.stringify(verifySettings, null, 2));
        
        await updateAccountUI();
        console.log('[Account] UI updated');
        
        showToast('success', `Account created successfully! Welcome, ${username}!`);

        document.getElementById('newUsername').value = '';
        document.getElementById('newDeviceName').value = '';
        } catch (error) {
            console.error('[Account] Create account failed:', error);
            showToast('error', 'Failed to create account: ' + (error.message || String(error)));
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    } catch (outerError) {
        console.error('[Account] Critical error in handleCreateAccount:', outerError);
        alert('Account creation error: ' + (outerError.message || String(outerError)));
    }
}

async function handlePairDevice(event) {
    try {
        event.preventDefault();
        
        const pairingCode = document.getElementById('pairingCode').value.trim().toUpperCase();
        const deviceName = document.getElementById('pairDeviceName').value.trim() || 'Desktop';

        if (!pairingCode || !/^[A-Z0-9_\-]{1,8}$/.test(pairingCode)) {
            showToast('error', 'Please enter a valid pairing code (up to 8 characters)');
            return;
        }

        const submitBtn = event.target.querySelector('button[type="submit"]');
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';

        try {
        const response = await makeAuthRequest('/auth/pairing/redeem', 'POST', {
            code: pairingCode,
            device_name: deviceName
        });

        if (response.error) {
            throw new Error(response.error);
        }

        authState = {
            isAuthenticated: true,
            username: response.user?.username || response.username,
            deviceId: response.device?.device_id || response.device_id,
            token: response.refresh_token || response.token,
            role: response.user?.is_owner ? 'owner' : 'user',
            createdAt: new Date().toISOString()
        };

        await saveAuthState();
        await updateAccountUI();
        showToast('success', `Device connected successfully to ${response.user?.username || 'your'}'s account!`);

        document.getElementById('pairingCode').value = '';
        document.getElementById('pairDeviceName').value = '';
        } catch (error) {
            console.error('[Account] Pair device failed:', error);
            showToast('error', 'Failed to pair device: ' + (error.message || String(error)));
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    } catch (outerError) {
        console.error('[Account] Critical error in handlePairDevice:', outerError);
        alert('Pairing error: ' + (outerError.message || String(outerError)));
    }
}

async function handleLogout() {
    const confirmed = confirm('Are you sure you want to logout? You will need a pairing code to reconnect this device.');
    if (!confirmed) return;

    try {
        await clearAuthState();
        await updateAccountUI();
        showToast('success', 'Logged out successfully');
    } catch (error) {
        console.error('[Account] Logout failed:', error);
        showToast('error', 'Failed to logout: ' + error.message);
    }
}

async function handleRefreshAccount() {
    const btn = document.getElementById('refreshAccountBtn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';

    try {
        await updateAccountUI();
        showToast('success', 'Account status refreshed');
    } catch (error) {
        console.error('[Account] Refresh failed:', error);
        showToast('error', 'Failed to refresh account status');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function handleRevokeDevice() {
    const confirmed = confirm('Are you sure you want to remove this device? You will need a pairing code to reconnect.');
    if (!confirmed) return;

    const btn = document.getElementById('revokeDeviceBtn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

    try {
        const response = await makeAuthRequest('/auth/revoke-device', 'POST', {
            device_id: authState.deviceId
        });

        if (response.error) {
            throw new Error(response.error);
        }

        await clearAuthState();
        await updateAccountUI();
        showToast('success', 'Device removed successfully');
    } catch (error) {
        console.error('[Account] Revoke device failed:', error);
        showToast('error', 'Failed to remove device: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function handleGeneratePairingCode() {
    const btn = document.getElementById('generatePairingCodeBtn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

    try {
        if (!authState.username || !authState.deviceId) {
            throw new Error('Authentication information missing');
        }

        const requestBody = {
            username: authState.username,
            device_id: authState.deviceId
        };

        const response = await makeAuthRequest('/auth/pairing/create', 'POST', requestBody);

        if (response.error) {
            throw new Error(response.error);
        }

        const pairingCode = response.code;
        const expiresAt = new Date(response.expires_at);
        const now = new Date();
        const expiresIn = Math.floor((expiresAt - now) / 1000);

        document.getElementById('generatedPairingCode').textContent = pairingCode;
        document.getElementById('pairingCodeDisplay').style.display = 'block';
        btn.style.display = 'none';

        startPairingCodeTimer(expiresIn);
        showToast('success', 'Pairing code generated successfully!');
    } catch (error) {
        console.error('[Account] Generate pairing code failed:', error);
        showToast('error', 'Failed to generate pairing code: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function startPairingCodeTimer(seconds) {
    if (pairingCodeTimer) {
        clearInterval(pairingCodeTimer);
    }

    let remaining = seconds;
    const timerElement = document.getElementById('pairingCodeTimer');
    
    const updateTimer = () => {
        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;
        timerElement.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        
        if (remaining <= 0) {
            clearInterval(pairingCodeTimer);
            document.getElementById('pairingCodeDisplay').style.display = 'none';
            document.getElementById('generatePairingCodeBtn').style.display = 'block';
            showToast('info', 'Pairing code expired');
        }
        remaining--;
    };

    updateTimer();
    pairingCodeTimer = setInterval(updateTimer, 1000);
}

async function handleCopyPairingCode() {
    const pairingCode = document.getElementById('generatedPairingCode').textContent;
    
    try {
        await navigator.clipboard.writeText(pairingCode);
        showToast('success', 'Pairing code copied to clipboard!');
    } catch (error) {
        console.error('[Account] Copy failed:', error);
        showToast('error', 'Failed to copy pairing code');
    }
}

async function makeAuthRequest(endpoint, method = 'GET', data = null, customToken = null) {
    try {
        const base = await getServerUrl();
        const url = `${base}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json'
        };

        if (customToken) {
            headers['Authorization'] = `Token ${customToken}`;
        } else if (authState.token) {
            headers['Authorization'] = `Token ${authState.token}`;
        }

        let response;
        const params = data ? '?' + new URLSearchParams(data).toString() : '';
        const options = {
            method: method,
            headers: headers,
            body: (method !== 'GET' && data) ? JSON.stringify(data) : null
        };
        
        response = await fetch(url + (method === 'GET' ? params : ''), options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
        }
        response = await response.json();

        return response;
    } catch (error) {
        console.error('[Account] API request failed:', error);
        return { error: error.message || 'Request failed' };
    }
}

async function createListeningRoom(name = 'Listening Room', isPrivate = false){
    const res = await makeAuthRequest('/rooms/create', 'POST', { name, is_private: isPrivate });
    if(res && !res.error){ currentRoom = { id: res.id, code: res.code, name: res.name }; }
    return res;
}

async function joinListeningRoomByCode(code){
    const res = await makeAuthRequest('/rooms/join', 'POST', { code });
    if(res && !res.error){ currentRoom = { id: res.room_id, code }; }
    return res;
}

async function connectRoomWebSocket(){
    if(!currentRoom || !authState || !authState.token) return;
    try{
        const base = await getServerUrl();
        const wsBase = base.replace('https','wss').replace('http','ws');
        const wsUrl = wsBase + `/rooms/ws?room_id=${encodeURIComponent(currentRoom.id)}&token=${encodeURIComponent(authState.token)}`;
        if(roomsWS){ try{ roomsWS.close(); }catch(_){} }
        roomsWS = new WebSocket(wsUrl);
        roomsWS.onopen = ()=>{};
        roomsWS.onmessage = async (ev)=>{
            try{
                const msg = JSON.parse(ev.data);
                if(msg.type === 'sync'){
                    const p = msg.payload || {};
                    if(typeof p.ts === 'number'){
                        if(p.ts <= lastRoomsTs) return;
                        lastRoomsTs = p.ts;
                    }
                    if(p.origin_device_id && authState && authState.deviceId && String(p.origin_device_id)===String(authState.deviceId)) return;
                    let media = backgroundAudio;
                    if(!media){
                        media = document.createElement('audio');
                        media.style.display = 'none';
                        document.body.appendChild(media);
                        backgroundAudio = media;
                    }
                    let base = await getServerUrl();
                    if(base && base.endsWith('/')) base = base.slice(0,-1);
                    if(p.server_path){
                        const streamUrl = `${base}/download?filepath=${encodeURIComponent(p.server_path)}`;
                        if(media.src !== streamUrl){
                            media.src = streamUrl;
                            try{ media.load(); }catch(_){ }
                        }
                    }
                    const addDrift = p.is_playing === true;
                    const driftMs = addDrift && (typeof p.ts==='number') ? Math.max(0, Date.now() - p.ts) : 0;
                    if(typeof p.position_ms === 'number'){
                        const target = Math.max(0, ((p.position_ms||0) + driftMs) / 1000);
                        const setTime = ()=>{ try{ media.currentTime = target; }catch(_){ } };
                        if(isNaN(media.duration) || media.readyState < 1){
                            try{ media.addEventListener('loadedmetadata', function once(){ try{ media.removeEventListener('loadedmetadata', once) }catch(_){ } setTime(); if(p.is_playing===true){ try{ media.play() }catch(_){ } } }, { once:true }) }catch(_){ }
                        } else {
                            setTime();
                        }
                    }
                    if(p.is_playing === true){ try{ media.play(); }catch(_){ }}
                    if(p.is_playing === false){ try{ media.pause(); }catch(_){ }}
                }
            }catch(_){ }
        };
        roomsWS.onclose = ()=>{ roomsWS = null; };
        roomsWS.onerror = ()=>{};
    }catch(_){ }
}

function broadcastRoomSync(payload){
    try{ if(roomsWS && roomsWS.readyState===1){ const enriched = Object.assign({ ts: Date.now() }, payload); roomsWS.send(JSON.stringify({ type:'sync', payload: enriched })); } }catch(_){ }
}

window.addEventListener('DOMContentLoaded', () => {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'account') {
                initializeAccountTab();
            }
        });
    });
});


