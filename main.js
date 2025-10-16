const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');
const { spawn } = require('child_process'); // <--- 1. 引入 spawn
const log = require('electron-log'); // <--- 2. 引入 electron-log

// 设置日志，它会自动记录到文件
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');
Object.assign(console, log.functions); // 让 console.log 也写入文件

let mainWindow;
let pythonShell; // 我们仍然用这个变量名，但它的内容会变

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // 调试时可以打开

    const isDev = !app.isPackaged;

    if (isDev) {
        // --- 开发环境：保持原来的 PythonShell ---
        const pythonOptions = {
            mode: 'json',
            pythonPath: process.platform === 'win32'
                ? path.join(__dirname, '.venv/Scripts/python.exe')
                : path.join(__dirname, '.venv/bin/python'),
            scriptPath: __dirname,
        };
        pythonShell = new PythonShell('backend.py', pythonOptions);

    } else {
        // --- 打包环境：使用原生 child_process.spawn ---
        const executableName = process.platform === 'win32' ? 'backend_service.exe' : 'backend_service';
        const pythonScriptPath = path.join(process.resourcesPath, 'backend', executableName);
        

        const child = spawn(pythonScriptPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        
        // 为了让后面的代码不用改，我们手动创建一个与 PythonShell 兼容的对象
        pythonShell = {
            send: (data) => {
                try {
                    child.stdin.write(JSON.stringify(data) + '\n', 'utf-8');
                } catch (e) {
                    log.error('Failed to send data to Python backend:', e);
                }
            },
            on: (event, listener) => {
                if (event === 'message') {
                    let buffer = '';
                    child.stdout.on('data', (data) => {
                        buffer += data.toString();
                        let lines = buffer.split('\n');
                        buffer = lines.pop(); // 保留不完整的行
                        for (const line of lines) {
                            if (line.trim()) {
                                try {
                                    listener(JSON.parse(line));
                                } catch (e) {
                                    log.error('Failed to parse JSON from backend:', line, e);
                                }
                            }
                        }
                    });
                } else if (event === 'stderr') {
                    child.stderr.on('data', (data) => listener(data.toString()));
                } else if (event === 'error') {
                    child.on('error', listener);
                } else if (event === 'close') {
                    child.on('close', listener);
                }
            },
            kill: () => child.kill(),
            terminated: child.killed
        };
        log.info('Backend process spawned successfully.');
    }

    pythonShell.on('message', (message) => {
        // ===> 添加这行日志 <===
        console.log(`[Node.js RECEIVED]: Got message from Python:`, message);
        if (mainWindow) {
            mainWindow.webContents.send('from-python', message);
        }
    });
    pythonShell.on('stderr', (stderr) => console.error(`[Python STDERR]: ${stderr}`));
    pythonShell.on('error', (err) => dialog.showErrorBox('后端错误', `Python 后端发生错误: \n${err.message || err}`));
    pythonShell.on('close', () => console.log('PythonShell process closed.'));
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (pythonShell && !pythonShell.terminated) pythonShell.kill();
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('to-python', (event, data) => {
    if (pythonShell) pythonShell.send(data);
});

ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (!canceled) return filePaths[0];
});

// === 新增：处理保存文件对话框的请求 ===
ipcMain.handle('dialog:showSaveDialog', async (event, defaultPath, format) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: '保存转换后的文件',
        defaultPath: defaultPath.replace(/\.[^/.]+$/, `.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (!canceled) return filePath;
});

// === 新增：处理确认对话框的请求 ===
ipcMain.handle('dialog:showConfirmDialog', async (event, message) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['取消', '确认删除'],
        defaultId: 0, // "取消" 按钮是默认
        cancelId: 0,
        title: '请确认',
        message: message,
        detail: '此操作无法撤销。'
    });
    // 如果用户点击了 "确认删除" (按钮索引为 1), 则返回 true
    return result.response === 1;
});

app.on('will-quit', () => {
    if (pythonShell && !pythonShell.terminated) pythonShell.kill();
});
