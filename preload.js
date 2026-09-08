'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prisma', {
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    testShortcut: (accelerator) => ipcRenderer.invoke('test-shortcut', accelerator),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
    getLocalFiles: () => ipcRenderer.invoke('get-local-files'),
    openLocalFile: (filePath) => ipcRenderer.invoke('open-local-file', filePath),
    hideSearchWindow: () => ipcRenderer.send('hide-search-window'),
    resizeSearchWindow: (height) => ipcRenderer.send('resize-search-window', height),
    openSettings: () => ipcRenderer.invoke('open-settings'),
    closeSettings: () => ipcRenderer.invoke('close-settings'),
    onWindowShown: (callback) => ipcRenderer.on('window-shown', callback),
    onConnectedViaLink: (callback) => ipcRenderer.on('connected-via-link', callback),
});
