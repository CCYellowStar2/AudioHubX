// renderer.js (已添加滑块填充效果)

// === 1. 获取所有 DOM 元素 ===
// (这部分保持不变)
const fileList = document.getElementById('file-list');
const browseBtn = document.getElementById('browse-btn');
const currentDirSpan = document.getElementById('current-dir');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const loopBtn = document.getElementById('loop-btn');
const progressSlider = document.getElementById('progress-slider');
const currentTimeLabel = document.getElementById('current-time');
const totalTimeLabel = document.getElementById('total-time');
const currentSongLabel = document.getElementById('current-song');
const volumeSlider = document.getElementById('volume-slider');
const volumeIconBtn = document.getElementById('volume-icon-btn');
const contextMenu = document.getElementById('context-menu');
const menuConvert = document.getElementById('menu-convert');
const menuDelete = document.getElementById('menu-delete');
const menuReveal = document.getElementById('menu-reveal');
const menuSelectAll = document.getElementById('menu-select-all');
const menuInvertSelection = document.getElementById('menu-invert-selection');
const menuInfo = document.getElementById('menu-info');
const converterModal = document.getElementById('converter-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const startConversionBtn = document.getElementById('start-conversion-btn');
const formatSelect = document.getElementById('format-select');
const bitrateSelect = document.getElementById('bitrate-select');
const bitrateGroup = document.getElementById('bitrate-group');
const modalSongName = document.getElementById('modal-song-name');
const progressArea = document.getElementById('progress-area');
const conversionProgressBar = document.getElementById('conversion-progress-bar');
const conversionStatus = document.getElementById('conversion-status');
const infoModal = document.getElementById('info-modal');
const closeInfoBtn = document.getElementById('close-info-btn');
const infoFilename = document.getElementById('info-filename');
const infoFilesize = document.getElementById('info-filesize');
const infoFormat = document.getElementById('info-format');
const infoDuration = document.getElementById('info-duration');
const infoBitrate = document.getElementById('info-bitrate');
const infoSamplerate = document.getElementById('info-samplerate');
const infoChannels = document.getElementById('info-channels');
const infoCodec = document.getElementById('info-codec');
const infoBitdepth = document.getElementById('info-bitdepth');
const infoFullpath = document.getElementById('info-fullpath');


// === 2. 状态管理 ===
// (这部分保持不变)
let playbackState = 'stopped';
let currentSelectedPath = null;
let isUserDraggingSlider = false;
let kickstartTimer = null;
let conversionWatchdogTimer = null;
let currentPlaylist = [];
let contextFile = null;
let isVolumeThrottled = false;
let multiSelectedPaths = new Set();
let lastClickedIndex = -1;
let lastVolumeBeforeMute = 1;
const icons = {
    loop: {
        NO_LOOP: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
        LOOP_LIST: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
        LOOP_ONE: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/><path d="m12 10-2-2"/></svg>`
    },
    volume: {
        muted: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
        low: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        full: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
    }
};
const loopModes = ['NO_LOOP', 'LOOP_LIST', 'LOOP_ONE'];
const loopTitles = {'NO_LOOP': '循环模式: 关闭', 'LOOP_LIST': '列表循环', 'LOOP_ONE': '单曲循环'};
let currentLoopIndex = 0;

// === 3. 工具函数与 UI 更新 ===
function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// === 新增：更新滑块填充颜色的函数 ===
function updateSliderFill(slider) {
    const percentage = (slider.value / slider.max) * 100 || 0;
    const colorPlayed = '#f43f5e'; // rose-500
    const colorUnplayed = '#334155'; // slate-700
    slider.style.background = `linear-gradient(to right, ${colorPlayed} ${percentage}%, ${colorUnplayed} ${percentage}%)`;
}


function updatePlayerUI() {
    // (逻辑保持不变)
    const isSongSelected = currentSelectedPath !== null;
    const isPlaylistAvailable = currentPlaylist.length > 0;
    playBtn.disabled = !isSongSelected;
    pauseBtn.disabled = !isSongSelected;
    prevBtn.disabled = !isPlaylistAvailable;
    nextBtn.disabled = !isPlaylistAvailable;

    switch (playbackState) {
        case 'playing':
            playBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            stopBtn.disabled = false;
            progressSlider.disabled = false;
            break;
        case 'paused':
            playBtn.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
            stopBtn.disabled = false;
            progressSlider.disabled = false;
            break;
        case 'stopped':
            playBtn.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
            stopBtn.disabled = true;
            progressSlider.disabled = true;
            progressSlider.value = 0;
            currentTimeLabel.textContent = '00:00';
            updateSliderFill(progressSlider); // 新增：重置填充
            break;
    }
}

// (其他函数保持不变...)
function updateVolumeIcon(volume) {
    if (volume === 0) {
        volumeIconBtn.innerHTML = icons.volume.muted;
    } else if (volume < 0.5) {
        volumeIconBtn.innerHTML = icons.volume.low;
    } else {
        volumeIconBtn.innerHTML = icons.volume.full;
    }
    updateSliderFill(volumeSlider); // 新增：同时更新音量条填充
}
const fileItemBaseClasses = 'file-item p-3 pl-4 cursor-pointer border-b border-slate-800 transition-colors duration-150 truncate hover:bg-slate-700/50';
const fileItemSelectedClasses = 'bg-rose-600/80 text-white font-semibold';
const fileItemMultiSelectedClasses = 'bg-slate-700';
function updateAllFileItemClasses() {
    fileList.querySelectorAll('.file-item').forEach(el => {
        el.classList.remove(...fileItemSelectedClasses.split(' '), ...fileItemMultiSelectedClasses.split(' '));
        const path = el.dataset.path;
        if (path === currentSelectedPath) {
            el.classList.add(...fileItemSelectedClasses.split(' '));
        } else if (multiSelectedPaths.has(path)) {
            el.classList.add(...fileItemMultiSelectedClasses.split(' '));
        }
    });
}

// === 4. 事件监听器 ===
// (大部分保持不变, 只在滑块监听器中添加调用)
browseBtn.addEventListener('click', async () => {
    const dirPath = await window.electronAPI.openDirectory();
    if (dirPath) scanDirectory(dirPath);
});
function scanDirectory(dirPath) {
    currentDirSpan.textContent = dirPath;
    fileList.innerHTML = '<p class="p-4 text-slate-400">正在扫描...</p>';
    currentPlaylist = [];
    playbackState = 'stopped';
    currentSelectedPath = null;
    multiSelectedPaths.clear();
    lastClickedIndex = -1;
    currentSongLabel.textContent = '请选择一首歌曲';
    totalTimeLabel.textContent = '00:00';
    updatePlayerUI();
    window.electronAPI.sendToPython({ command: 'scan', data: { path: dirPath } });
}
fileList.addEventListener('click', (event) => {
    const target = event.target.closest('.file-item');
    if (!target) return;
    const allItems = Array.from(fileList.querySelectorAll('.file-item'));
    const currentIndex = allItems.indexOf(target);
    const path = target.dataset.path;
    if (event.shiftKey && lastClickedIndex !== -1) {
        multiSelectedPaths.clear();
        const start = Math.min(lastClickedIndex, currentIndex);
        const end = Math.max(lastClickedIndex, currentIndex);
        for (let i = start; i <= end; i++) {
            multiSelectedPaths.add(allItems[i].dataset.path);
        }
    } else if (event.ctrlKey || event.metaKey) {
        if (multiSelectedPaths.has(path)) {
            multiSelectedPaths.delete(path);
        } else {
            multiSelectedPaths.add(path);
        }
        lastClickedIndex = currentIndex;
    } else {
        multiSelectedPaths.clear();
        multiSelectedPaths.add(path);
        currentSelectedPath = path;
        lastClickedIndex = currentIndex;
    }
    updateAllFileItemClasses();
    updatePlayerUI();
});
fileList.addEventListener('dblclick', (event) => {
    const target = event.target.closest('.file-item');
    if (target) {
        currentSelectedPath = target.dataset.path;
        multiSelectedPaths.clear();
        multiSelectedPaths.add(currentSelectedPath);
        updateAllFileItemClasses();
        window.electronAPI.sendToPython({ command: 'play', data: { path: currentSelectedPath } });
    }
});
fileList.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const target = event.target.closest('div.file-item');
    if (target) {
        contextFile = target.dataset.path;
        if (!multiSelectedPaths.has(contextFile)) {
            multiSelectedPaths.clear();
            currentSelectedPath = contextFile;
            multiSelectedPaths.add(contextFile);
            updateAllFileItemClasses();
        }
        const selectionCount = multiSelectedPaths.size;
        menuDelete.firstElementChild.nextSibling.textContent = `删除 ${selectionCount} 个文件`;
        const singleSelectionOnly = selectionCount === 1 ? 'flex' : 'none';
        menuInfo.style.display = singleSelectionOnly;
        menuConvert.style.display = singleSelectionOnly;
        menuReveal.style.display = singleSelectionOnly;
        contextMenu.style.top = `${event.clientY}px`;
        contextMenu.style.left = `${event.clientX}px`;
        contextMenu.classList.remove('hidden');
    }
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item') && !e.target.closest('.context-menu')) {
        multiSelectedPaths.clear();
        updateAllFileItemClasses();
    }
    contextMenu.classList.add('hidden');
});
menuInfo.addEventListener('click', () => { if (contextFile) { window.electronAPI.sendToPython({ command: 'get-audio-info', data: { path: contextFile } }); } });
menuReveal.addEventListener('click', () => { if (contextFile) { window.electronAPI.sendToPython({ command: 'reveal-in-explorer', data: { path: contextFile } }); } });
menuSelectAll.addEventListener('click', () => { fileList.querySelectorAll('.file-item').forEach(item => multiSelectedPaths.add(item.dataset.path)); updateAllFileItemClasses(); });
menuInvertSelection.addEventListener('click', () => {
    const allPaths = Array.from(fileList.querySelectorAll('.file-item')).map(el => el.dataset.path);
    allPaths.forEach(path => { if(multiSelectedPaths.has(path)) { multiSelectedPaths.delete(path); } else { multiSelectedPaths.add(path); } });
    updateAllFileItemClasses();
});
menuConvert.addEventListener('click', () => {
    if (contextFile) {
        modalSongName.textContent = contextFile.split(/[\\/]/).pop();
        converterModal.classList.remove('hidden');
        progressArea.classList.add('hidden');
        conversionProgressBar.style.width = '0%';
        conversionStatus.textContent = '0%';
        startConversionBtn.disabled = false;
        formatSelect.disabled = false;
        bitrateSelect.disabled = false;
    }
});
menuDelete.addEventListener('click', async () => {
    if (multiSelectedPaths.size === 0) return;
    const fileCount = multiSelectedPaths.size;
    const message = `你确定要删除这 ${fileCount} 个文件吗？`;
    const confirmed = await window.electronAPI.showConfirmDialog(message);
    if (confirmed) { window.electronAPI.sendToPython({ command: 'delete-files', data: { paths: Array.from(multiSelectedPaths) } }); }
});
closeModalBtn.addEventListener('click', () => {
    converterModal.classList.add('hidden');
    if (conversionWatchdogTimer) { clearInterval(conversionWatchdogTimer); conversionWatchdogTimer = null; }
});
closeInfoBtn.addEventListener('click', () => { infoModal.classList.add('hidden'); });
formatSelect.addEventListener('change', () => { bitrateGroup.style.display = formatSelect.value === 'mp3' ? 'block' : 'none'; });
startConversionBtn.addEventListener('click', async () => {
    const format = formatSelect.value;
    const options = {};
    if (format === 'mp3') options['b:a'] = bitrateSelect.value;
    const savePath = await window.electronAPI.showSaveDialog(contextFile, format);
    if (savePath) {
        startConversionBtn.disabled = true; formatSelect.disabled = true; bitrateSelect.disabled = true;
        progressArea.classList.remove('hidden');
        window.electronAPI.sendToPython({ command: 'convert', data: { input_path: contextFile, output_path: savePath, format, options } });
        if (conversionWatchdogTimer) clearInterval(conversionWatchdogTimer);
        conversionWatchdogTimer = setInterval(() => {
            console.warn("看门狗启动！发送无害命令唤醒后端...");
            window.electronAPI.sendToPython({ command: 'set-loop-mode', data: { mode: loopModes[currentLoopIndex] } });
        }, 500);
    }
});
playBtn.addEventListener('click', () => {
    if (playbackState === 'paused') {
        playbackState = 'playing';
        updatePlayerUI();
        window.electronAPI.sendToPython({ command: 'unpause' });
    } else if (playbackState === 'stopped' && currentSelectedPath) {
        window.electronAPI.sendToPython({ command: 'play', data: { path: currentSelectedPath } });
    }
});
pauseBtn.addEventListener('click', () => { playbackState = 'paused'; updatePlayerUI(); clearTimeout(kickstartTimer); window.electronAPI.sendToPython({ command: 'pause' }); });
stopBtn.addEventListener('click', () => { clearTimeout(kickstartTimer); window.electronAPI.sendToPython({ command: 'stop' }); });
prevBtn.addEventListener('click', () => { window.electronAPI.sendToPython({ command: 'play-previous' }); });
nextBtn.addEventListener('click', () => { window.electronAPI.sendToPython({ command: 'play-next' }); });
loopBtn.addEventListener('click', () => {
    currentLoopIndex = (currentLoopIndex + 1) % loopModes.length;
    const newMode = loopModes[currentLoopIndex];
    loopBtn.innerHTML = icons.loop[newMode];
    loopBtn.title = loopTitles[newMode];
    window.electronAPI.sendToPython({ command: 'set-loop-mode', data: { mode: newMode } });
});
progressSlider.addEventListener('mousedown', () => { isUserDraggingSlider = true; });
progressSlider.addEventListener('input', () => {
    currentTimeLabel.textContent = formatTime(progressSlider.value);
    updateSliderFill(progressSlider); // 新增：拖动时实时更新填充
});
progressSlider.addEventListener('change', () => {
    const seekPosition = parseInt(progressSlider.value, 10);
    window.electronAPI.sendToPython({ command: 'seek', data: { position: seekPosition } });
    isUserDraggingSlider = false;
});
volumeSlider.addEventListener('input', () => {
    const volumeLevel = parseFloat(volumeSlider.value) / 100;
    updateVolumeIcon(volumeLevel);
    if (isVolumeThrottled) return;
    isVolumeThrottled = true;
    window.electronAPI.sendToPython({ command: 'set-volume', data: { volume: volumeLevel } });
    setTimeout(() => { isVolumeThrottled = false; }, 50);
});
volumeIconBtn.addEventListener('click', () => {
    const currentVolume = parseFloat(volumeSlider.value);
    if (currentVolume > 0) {
        lastVolumeBeforeMute = currentVolume / 100;
        volumeSlider.value = 0;
    } else {
        volumeSlider.value = lastVolumeBeforeMute * 100;
    }
    volumeSlider.dispatchEvent(new Event('input'));
});

// === 5. 处理来自 Python 的消息 ===
window.electronAPI.handleFromPython((message) => {
    const { type, data } = message;
    if (type === 'scan-chunk') {
        if (fileList.innerHTML.includes('正在扫描')) fileList.innerHTML = '';
        data.chunk.forEach(file => { currentPlaylist.push(file.path); const item = document.createElement('div'); item.className = fileItemBaseClasses; item.textContent = file.name; item.dataset.path = file.path; fileList.appendChild(item); });
    } else if (type === 'scan-finished') {
        if (fileList.innerHTML.includes('正在扫描') || fileList.innerHTML === '') { fileList.innerHTML = '<p class="p-4 text-slate-400">未找到音频文件。</p>'; }
    } else if (type === 'playback-started') {
        playbackState = 'playing';
        updatePlayerUI();
        progressSlider.max = data.duration;
        totalTimeLabel.textContent = formatTime(data.duration);
        currentSongLabel.textContent = data.path.split(/[\\/]/).pop();
        currentSelectedPath = data.path;
        updateAllFileItemClasses();
        updateSliderFill(progressSlider); // 新增：播放开始时更新填充
        kickstartTimer = setTimeout(() => { window.electronAPI.sendToPython({ command: 'unpause' }); }, 100);
    } else if (type === 'position-changed') {
        if (kickstartTimer) { clearTimeout(kickstartTimer); kickstartTimer = null; }
        if (!isUserDraggingSlider && playbackState !== 'stopped') {
            progressSlider.value = data.position;
            currentTimeLabel.textContent = formatTime(data.position);
            updateSliderFill(progressSlider); // 新增：播放时更新填充
        }
    } else if (type === 'playback-stopped' || type === 'playback-finished') {
        clearTimeout(kickstartTimer);
        playbackState = 'stopped';
        if (type === 'playback-finished') {
            currentSongLabel.textContent = '播放完毕';
            currentSelectedPath = null;
            updateAllFileItemClasses();
        } else if (currentSelectedPath) {
            currentSongLabel.textContent = currentSelectedPath.split(/[\\/]/).pop();
        }
        updatePlayerUI();
    } else if (type === 'playback-error') {
		clearTimeout(kickstartTimer);
        alert(`播放错误: ${data.error}`);
        playbackState = 'stopped';
        updatePlayerUI();
    } else if (type === 'conversion-progress') {
        if (conversionWatchdogTimer) { clearInterval(conversionWatchdogTimer); conversionWatchdogTimer = null; }
        conversionProgressBar.style.width = `${data.progress}%`;
        conversionStatus.textContent = `${data.progress}%`;
    } else if (type === 'conversion-finished') {
        if (conversionWatchdogTimer) { clearInterval(conversionWatchdogTimer); conversionWatchdogTimer = null; }
        if (data.error) { alert(`转换失败: ${data.error}`); } 
        else { alert(`转换成功！文件已保存到: ${data.path}`); const currentDir = currentDirSpan.textContent; if (currentDir && currentDir !== '未选择') { scanDirectory(currentDir); } }
        converterModal.classList.add('hidden');
    } else if (type === 'files-deleted') {
        data.deleted.forEach(path => {
            const el = fileList.querySelector(`div[data-path="${CSS.escape(path)}"]`);
            if (el) el.remove();
            const index = currentPlaylist.indexOf(path);
            if (index > -1) currentPlaylist.splice(index, 1);
        });
        multiSelectedPaths.clear();
        lastClickedIndex = -1;
        if (data.deleted.includes(currentSelectedPath)) {
            currentSelectedPath = null;
            currentSongLabel.textContent = '请选择一首歌曲';
            totalTimeLabel.textContent = '00:00';
        }
        updateAllFileItemClasses();
        updatePlayerUI();
    } else if (type === 'audio-info') {
        if (data.error) { alert(`无法获取文件信息: ${data.error}`); return; }
        infoFilename.textContent = data.filename || '-';
        infoFilesize.textContent = data.filesize || '-';
        infoFormat.textContent = data.format || '-';
        infoDuration.textContent = data.duration || '-';
        infoBitrate.textContent = data.bitrate || '-';
        infoSamplerate.textContent = data.samplerate || '-';
        infoChannels.textContent = data.channels || '-';
        infoCodec.textContent = data.codec || '-';
        infoBitdepth.textContent = data.bitdepth || '-';
        infoFullpath.textContent = data.fullpath || '-';
        infoModal.classList.remove('hidden');
    }
});

// === 初始化 ===
function init() {
    loopBtn.innerHTML = icons.loop.NO_LOOP;
    updateVolumeIcon(1);
    updatePlayerUI();
    // 新增：初始化时也为滑块设置背景
    updateSliderFill(progressSlider);
    updateSliderFill(volumeSlider);
}

init();
