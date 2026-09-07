'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store({
    defaults: {
        serverUrl: '',
        uid: '',
        apiKey: '',
        shortcut: 'CommandOrControl+Alt+K',
        launchAtStartup: true,
        syncBookmarks: false,
    },
});

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+K';

let tray = null;
let searchWindow = null;
let settingsWindow = null;
let currentShortcut = null;

// Evita múltiplas instâncias do agente rodando ao mesmo tempo.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        toggleSearchWindow();
    });
}

function isConfigured() {
    const cfg = store.store;
    return !!(cfg.serverUrl && cfg.uid && cfg.apiKey);
}

function createSearchWindow() {
    searchWindow = new BrowserWindow({
        width: 600,
        height: 64,
        minHeight: 64,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    searchWindow.loadFile(path.join(__dirname, 'renderer', 'search.html'));
    searchWindow.setAlwaysOnTop(true, 'screen-saver');
    searchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Perde o foco (usuário clicou fora) → esconde, igual Spotlight/Alfred/Raycast.
    searchWindow.on('blur', () => {
        if (searchWindow && !searchWindow.webContents.isDevToolsFocused()) {
            hideSearchWindow();
        }
    });
}

function centerSearchWindow() {
    if (!searchWindow) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width: sw } = display.workArea;
    const [winWidth, winHeight] = searchWindow.getSize();
    const x = Math.round(display.workArea.x + (sw - winWidth) / 2);
    const y = Math.round(display.workArea.y + display.workArea.height * 0.22);
    searchWindow.setPosition(x, y);
}

function showSearchWindow() {
    if (!searchWindow || searchWindow.isDestroyed()) createSearchWindow();

    if (!isConfigured()) {
        openSettingsWindow();
        return;
    }

    centerSearchWindow();
    searchWindow.show();
    searchWindow.focus();
    searchWindow.webContents.send('window-shown');
}

function hideSearchWindow() {
    if (searchWindow && !searchWindow.isDestroyed()) {
        searchWindow.hide();
    }
}

function toggleSearchWindow() {
    if (searchWindow && searchWindow.isVisible()) {
        hideSearchWindow();
    } else {
        showSearchWindow();
    }
}

function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 480,
        height: 560,
        resizable: false,
        title: 'Configurações — PRISMA Launcher',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

function registerShortcut(accelerator) {
    if (currentShortcut) {
        globalShortcut.unregister(currentShortcut);
        currentShortcut = null;
    }

    const target = accelerator || DEFAULT_SHORTCUT;

    try {
        const ok = globalShortcut.register(target, toggleSearchWindow);
        if (ok) {
            currentShortcut = target;
            return true;
        }
    } catch (e) {
        // accelerator inválido — cai no fallback abaixo
    }

    // Combinação indisponível (já usada por outro app) — tenta o padrão como fallback.
    if (target !== DEFAULT_SHORTCUT) {
        try {
            if (globalShortcut.register(DEFAULT_SHORTCUT, toggleSearchWindow)) {
                currentShortcut = DEFAULT_SHORTCUT;
            }
        } catch (e) { /* nada mais a fazer */ }
    }

    return false;
}

let updateInfo = null; // { version, download_url } quando há versão mais nova disponível

function rebuildTrayMenu() {
    if (!tray) return;

    const items = [
        { label: 'Abrir busca', click: showSearchWindow },
        { label: 'Configurações', click: openSettingsWindow },
    ];

    if (updateInfo) {
        items.push({ type: 'separator' });
        items.push({
            label: 'Nova versão disponível (' + updateInfo.version + ')',
            click: () => shell.openExternal(updateInfo.download_url),
        });
    }

    items.push({ type: 'separator' });
    items.push({ label: 'Sair', click: () => app.quit() });

    tray.setContextMenu(Menu.buildFromTemplate(items));
    tray.setToolTip(updateInfo ? 'PRISMA Launcher — nova versão disponível' : 'PRISMA Launcher');
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    tray = new Tray(iconPath);
    tray.on('click', showSearchWindow);
    rebuildTrayMenu();
}

// ── Sincronização automática de favoritos (Chrome/Edge/Brave) ─────────────
// Opt-in via Configurações. Lê o arquivo local "Bookmarks" (JSON) desses
// navegadores, que já é o mesmo formato usado por ferramentas equivalentes
// (ex.: extensão Browser Bookmarks do ueli) — não existe API de "permissão"
// do SO pra isso, é leitura direta de um arquivo do próprio usuário.

function candidateBookmarkFiles() {
    const home = os.homedir();
    const platform = process.platform;
    const candidates = [];

    if (platform === 'linux') {
        candidates.push(
            path.join(home, '.config/google-chrome/Default/Bookmarks'),
            path.join(home, '.config/microsoft-edge/Default/Bookmarks'),
            path.join(home, '.config/BraveSoftware/Brave-Browser/Default/Bookmarks'),
            path.join(home, '.config/chromium/Default/Bookmarks')
        );
    } else if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        candidates.push(
            path.join(localAppData, 'Google/Chrome/User Data/Default/Bookmarks'),
            path.join(localAppData, 'Microsoft/Edge/User Data/Default/Bookmarks'),
            path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks')
        );
    } else if (platform === 'darwin') {
        candidates.push(
            path.join(home, 'Library/Application Support/Google/Chrome/Default/Bookmarks'),
            path.join(home, 'Library/Application Support/Microsoft Edge/Default/Bookmarks'),
            path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks')
        );
    }

    return candidates.filter((p) => {
        try { return fs.statSync(p).isFile(); } catch (e) { return false; }
    });
}

function walkChromiumBookmarks(node, out) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'url' && typeof node.url === 'string') {
        out.push({ title: node.name || node.url, url: node.url });
        return;
    }
    if (Array.isArray(node.children)) {
        for (const child of node.children) walkChromiumBookmarks(child, out);
    }
}

function parseChromiumBookmarksFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const roots = (data && data.roots) || {};
        const out = [];
        for (const key of Object.keys(roots)) walkChromiumBookmarks(roots[key], out);
        return out;
    } catch (e) {
        return [];
    }
}

const bookmarkFileState = new Map(); // filePath -> última mtime vista

async function syncBookmarksNow() {
    if (!store.get('syncBookmarks') || !isConfigured()) return;

    const files = candidateBookmarkFiles();
    if (!files.length) return;

    const byUrl = new Map();
    for (const file of files) {
        for (const item of parseChromiumBookmarksFile(file)) {
            if (item.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
        }
    }

    const items = Array.from(byUrl.values());
    if (!items.length) return;

    const serverUrl = store.get('serverUrl');
    const body = new URLSearchParams({
        uid: store.get('uid'),
        key: store.get('apiKey'),
        items: JSON.stringify(items),
    });

    try {
        await fetch(serverUrl + '/agent/bookmarks/sync', { method: 'POST', body });
    } catch (e) {
        // sem conexão — tenta de novo no próximo ciclo de polling
    }
}

function startBookmarkSyncPolling() {
    setInterval(() => {
        if (!store.get('syncBookmarks')) return;

        const files = candidateBookmarkFiles();
        let changed = false;

        for (const file of files) {
            try {
                const mtime = fs.statSync(file).mtimeMs;
                if (bookmarkFileState.get(file) !== mtime) {
                    bookmarkFileState.set(file, mtime);
                    changed = true;
                }
            } catch (e) { /* arquivo pode ter sumido — ignora */ }
        }

        if (changed) syncBookmarksNow();
    }, 30 * 1000);
}

/**
 * Compara duas versões "x.y.z" — retorna true se `remote` for mais nova que `local`.
 */
function isNewerVersion(remote, local) {
    const r = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
    const l = String(local).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const a = r[i] || 0;
        const b = l[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return false;
}

async function checkForUpdates() {
    const serverUrl = store.get('serverUrl');
    if (!serverUrl) return;

    try {
        const res = await fetch(serverUrl + '/download/version.json');
        if (!res.ok) return;
        const data = await res.json();

        if (data && data.version && isNewerVersion(data.version, app.getVersion())) {
            updateInfo = { version: data.version, download_url: data.download_url || (serverUrl + '/download') };
        } else {
            updateInfo = null;
        }
        rebuildTrayMenu();
    } catch (e) {
        // sem conexão ou servidor indisponível — silencioso, tenta de novo na próxima checagem
    }
}

app.whenReady().then(() => {
    if (process.platform === 'darwin') {
        app.dock.hide();
    }

    createTray();
    createSearchWindow();

    const shortcut = store.get('shortcut') || DEFAULT_SHORTCUT;
    registerShortcut(shortcut);

    app.setLoginItemSettings({ openAtLogin: !!store.get('launchAtStartup') });

    if (!isConfigured()) {
        openSettingsWindow();
    }

    checkForUpdates();
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000); // reverifica a cada 6h

    syncBookmarksNow();
    startBookmarkSyncPolling();
});

app.on('window-all-closed', (e) => {
    // Agente vive na bandeja — fechar uma janela não deve encerrar o processo.
    e.preventDefault?.();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// ── IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => store.store);

ipcMain.handle('save-config', (event, config) => {
    store.set('serverUrl', String(config.serverUrl || '').replace(/\/+$/, ''));
    store.set('uid', String(config.uid || ''));
    store.set('apiKey', String(config.apiKey || ''));
    store.set('launchAtStartup', !!config.launchAtStartup);
    store.set('syncBookmarks', !!config.syncBookmarks);

    const registered = registerShortcut(config.shortcut || DEFAULT_SHORTCUT);
    store.set('shortcut', currentShortcut || DEFAULT_SHORTCUT);

    app.setLoginItemSettings({ openAtLogin: !!config.launchAtStartup });
    checkForUpdates();
    if (config.syncBookmarks) syncBookmarksNow();

    return { success: true, shortcutApplied: currentShortcut, shortcutRequestedOk: registered };
});

ipcMain.handle('test-shortcut', (event, accelerator) => {
    // Testa se o SO permite registrar esse atalho, sem substituir o atual.
    try {
        const alreadyUsed = globalShortcut.isRegistered(accelerator);
        if (alreadyUsed && accelerator === currentShortcut) return { available: true };

        const probe = globalShortcut.register(accelerator, () => {});
        if (probe) globalShortcut.unregister(accelerator);
        return { available: !!probe };
    } catch (e) {
        return { available: false };
    }
});

ipcMain.handle('open-external', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(String(text ?? ''));
    return { success: true };
});

ipcMain.on('hide-search-window', () => {
    hideSearchWindow();
});

ipcMain.on('resize-search-window', (event, height) => {
    if (!searchWindow || searchWindow.isDestroyed()) return;
    const clamped = Math.max(64, Math.min(560, Math.round(height)));
    const [width] = searchWindow.getSize();
    searchWindow.setSize(width, clamped, false);
});

ipcMain.handle('open-settings', () => {
    openSettingsWindow();
    return { success: true };
});

ipcMain.handle('close-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    return { success: true };
});
