const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendToPython: (data) => ipcRenderer.send('to-python', data),
    handleFromPython: (callback) => ipcRenderer.on('from-python', (_event, value) => callback(value)),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
	// === 新增：暴露确认对话框的API ===
    showConfirmDialog: (message) => ipcRenderer.invoke('dialog:showConfirmDialog', message),
    // === 新增：暴露保存文件对话框的 API ===
    showSaveDialog: (defaultPath, format) => ipcRenderer.invoke('dialog:showSaveDialog', defaultPath, format),
});
