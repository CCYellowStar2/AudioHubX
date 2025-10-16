import os
import sys
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stdin.encoding != 'utf-8':
    sys.stdin.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')
import json
import time
import queue
import subprocess # <--- 使用 subprocess
import threading # <--- 确保导入 threading
from enum import Enum, auto
import multiprocessing
import converter_script
# 删除了所有不再需要的 PyQt UI 相关导入
from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import QObject, QThread, pyqtSignal, QTimer

import av
import numpy as np
import pyaudio

    
class AudioPlayerThread(QThread):
    # --- 信号部分保持不变 ---
    position_changed = pyqtSignal(float)
    playback_started = pyqtSignal(str, float)
    playback_finished = pyqtSignal()
    playback_error = pyqtSignal(str)
    seek_completed = pyqtSignal(int)

    CHUNK_SIZE = 4096

    def __init__(self):
        super().__init__()
        self.play_queue = queue.Queue()
        self.command_queue = queue.Queue()
        self.volume = 1.0 # <--- 新增：音量状态，默认为 100%
        self._stop = False
        
        self.p_audio = pyaudio.PyAudio()
        self.stream = None
        
        self.current_file = None
        self.total_duration_sec = 0
        
        self._paused = False
        self._interrupt = False
        self.is_song_active = False
        self.playback_start_time = 0
        self.paused_at_sec = 0
        self.pending_seek_while_paused = None
        
    @property
    def is_active(self):
        return self.is_song_active

    def run(self):
        while not self._stop:
            try:
                file_path = self.play_queue.get(timeout=0.1)
                if not file_path or not os.path.isfile(file_path):
                    continue
                
                self._interrupt = False
                self.is_song_active = True
                self.current_file = file_path
                self.pending_seek_while_paused = None # 重置
                
                container = None
                seek_target = None
                
                try:
                    while self.is_song_active and not self._interrupt and not self._stop:
                        container = av.open(file_path)
                        audio_stream = container.streams.audio[0]
                        
                        if seek_target is not None:
                            pts_target = int(seek_target / audio_stream.time_base)
                            container.seek(pts_target, stream=audio_stream, backward=True)
                            seek_target = None
                        else:
                            self.total_duration_sec = float(audio_stream.duration * audio_stream.time_base)
                            sample_rate = audio_stream.rate
                            channels = audio_stream.layout.nb_channels
                            self.playback_started.emit(file_path, self.total_duration_sec)
                            self.stream = self.p_audio.open(
                                format=pyaudio.paInt16, channels=channels, rate=sample_rate, output=True)
                            self.playback_start_time = time.time()
                            self.paused_at_sec = 0
                            self._paused = False

                        resampler = None
                        source_format = audio_stream.codec_context.format.name
                        if source_format != 's16':
                            resampler = av.AudioResampler(format='s16', layout=audio_stream.layout.name, rate=audio_stream.rate)
                        

                        for frame in container.decode(audio_stream):
                            if self._stop or self._interrupt: break
                            
                            # --- 1. 命令处理与暂停等待区 ---
                            # 这是一个统一的循环，它会一直处理命令，直到播放器不处于暂停状态
                            # 并且没有 seek 请求。
                            while self._paused or not self.command_queue.empty():
                                seek_val = self.process_commands()
                                if seek_val is not None:
                                    seek_target = seek_val
                                    break # 收到 seek 指令，跳出等待循环
                                
                                # 如果处理完命令后仍然是暂停状态，就短暂休眠
                                if self._paused:
                                    time.sleep(0.01)
                                else:
                                    # 如果不是暂停状态了（比如收到了unpause），就跳出等待循环
                                    break
                                
                                if self._stop or self._interrupt: break
                            
                            if self._stop or self._interrupt or seek_target is not None: break

                            # --- 2. 音频帧处理区 ---
                            # 能走到这里，说明播放器一定处于“播放”状态
                            frames_to_process = [frame]
                            if resampler:
                                frames_to_process = resampler.resample(frame)

                            for final_frame in frames_to_process:
                                # === 核心：音量处理 ===
                                # 1. 将音频帧数据转换为 numpy 数组
                                audio_data_np = final_frame.to_ndarray().astype(np.float32)
                                # 2. 将数组中的每个采样点乘以音量系数
                                audio_data_np *= self.volume
                                # 3. 将数据裁剪回 16 位整数范围，防止溢出
                                audio_data_np = np.clip(audio_data_np, -32768, 32767)
                                # 4. 转换回原来的数据类型并写入流
                                audio_bytes = audio_data_np.astype(np.int16).tobytes()
                                if self.stream: self.stream.write(audio_bytes)
                            
                            current_pos = time.time() - self.playback_start_time
                            self.position_changed.emit(current_pos)
                        
                        container.close()
                        container = None
                        
                        if seek_target is None:
                            break

                    if not self._stop and not self._interrupt:
                        self.playback_finished.emit()

                except Exception as e:
                    self.playback_error.emit(f"({os.path.basename(file_path)}): {e}")
                finally:
                    self.is_song_active = False
                    if self.stream:
                        self.stream.stop_stream()
                        self.stream.close()
                        self.stream = None
                    if container:
                        container.close()

            except queue.Empty:
                continue
        
        self.p_audio.terminate()

    # process_commands 方法保持我上次提供的版本，它本身是正确的
    def process_commands(self):
        try:
            cmd, value = self.command_queue.get_nowait()
            if cmd == 'pause':
                if not self._paused:
                    self.paused_at_sec = time.time() - self.playback_start_time
                    self._paused = True
            
            elif cmd == 'unpause':
                if self._paused:
                    if self.pending_seek_while_paused is not None:
                        seek_val = self.pending_seek_while_paused
                        self.pending_seek_while_paused = None
                        self.playback_start_time = time.time() - seek_val
                        self._paused = False
                        return seek_val
                    else:
                        self.playback_start_time = time.time() - self.paused_at_sec
                        self._paused = False

            elif cmd == 'seek':
                self.paused_at_sec = value
                self.seek_completed.emit(int(value))
                
                if self._paused:
                    self.pending_seek_while_paused = value
                else:
                    self.playback_start_time = time.time() - value
                    return value
            elif cmd == 'set-volume': # <--- 新增：处理音量命令
                self.volume = float(value)
        except queue.Empty:
            pass
        return None
        
    def _cleanup_stream_resources(self):
        pass # No longer needed, cleanup is in the `finally` block

    # --- 公共控制方法 (无需修改) ---
    def pause(self): self.command_queue.put(('pause', None))
    def unpause(self): self.command_queue.put(('unpause', None))
    def seek(self, position_sec): self.command_queue.put(('seek', position_sec))
    def add_to_queue(self, file_path): self.play_queue.put(file_path)
    def set_volume(self, volume_level):
        self.command_queue.put(('set-volume', volume_level))
    
    def interrupt(self):
        self._interrupt = True
        self.is_song_active = False

    def stop(self):
        self._stop = True
        self.interrupt()
        
    def clear_queue(self):
        while not self.play_queue.empty():
            try: self.play_queue.get_nowait()
            except queue.Empty: pass
                
    def remove_file_from_queue(self, file_path):
        temp_queue = queue.Queue()
        while not self.play_queue.empty():
            try:
                item = self.play_queue.get_nowait()
                if item != file_path: temp_queue.put(item)
            except queue.Empty: break
        self.play_queue = temp_queue


class FileScannerThread(QThread):
    # 不再需要 pyqtSignal
    def __init__(self, directory, result_queue, parent=None):
        super().__init__(parent)
        self.directory = directory
        self.result_queue = result_queue
        self.is_running = True
        self.CHUNK_SIZE = 100

    def run(self):
        audio_extensions = ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.wma', '.aac')
        chunk = []
        total_files = 0
        try:
            print(f"SCANNER: Starting to scan directory: {self.directory}", file=sys.stderr, flush=True)
            for entry in os.scandir(self.directory):
                if not self.is_running: break
                if entry.is_file() and entry.name.lower().endswith(audio_extensions):
                    try:
                        print(f"SCANNER: Found audio file: {entry.name}", file=sys.stderr, flush=True)
                        file_path = entry.path
                        file_size = entry.stat().st_size
                        chunk.append({'name': entry.name, 'path': file_path, 'size': file_size})
                        if len(chunk) >= self.CHUNK_SIZE:
                            self.result_queue.put(('chunk', chunk))
                            chunk = []
                    except OSError: continue
            
            if self.is_running and chunk:
                self.result_queue.put(('chunk', chunk))

            # 重新扫描以获得准确的总数，避免 os.scandir 迭代器耗尽
            total_files = sum(1 for f in os.scandir(self.directory) if f.is_file() and f.name.lower().endswith(audio_extensions))
        except Exception as e:
            print(f"SCANNER ERROR: An exception occurred: {e}", file=sys.stderr, flush=True)
            self.result_queue.put(('error', str(e)))
        finally:
            if self.is_running:
                print(f"SCANNER: Finished scan. Total files: {total_files}", file=sys.stderr, flush=True)
                self.result_queue.put(('finished', total_files))

    def stop(self):
        self.is_running = False

class LoopMode(Enum):
    NO_LOOP = auto()      # 不循环
    LOOP_LIST = auto()    # 列表循环
    LOOP_ONE = auto()     # 单曲循环

class ConverterThread(QThread):
    progress = pyqtSignal(int)
    finished = pyqtSignal(dict)

    def __init__(self, input_path, output_path, target_format, options):
        super().__init__()
        self.input_path = input_path
        self.output_path = output_path
        self.target_format = target_format
        self.options = options

    def run(self):
        try:
            # 将 options 字典转换为 JSON 字符串以匹配函数签名
            options_json = json.dumps(self.options)
            
            # === 核心改动：直接调用函数！ ===
            # 我们将 self.progress.emit 这个Qt信号作为回调函数传递进去
            result_data = converter_script.convert_with_pyav(
                self.input_path,
                self.output_path,
                self.target_format,
                options_json,
                progress_callback=self.progress.emit # <--- 绝妙的技巧！
            )
            
            # 函数成功返回，发送完成信号
            self.finished.emit(result_data)

        except Exception as e:
            # 函数抛出异常，发送包含错误的完成信号
            self.finished.emit({'path': self.output_path, 'error': str(e)})
        
class HeadlessApplication(QObject):
    command_received = pyqtSignal(dict)

    def __init__(self):
        super().__init__()
        
        # --- 新增状态管理 ---
        self.current_playlist = []
        self.current_index = -1
        self.loop_mode = LoopMode.NO_LOOP
        
        self.player_thread = AudioPlayerThread()
        self.player_thread.start()
        self.player_thread.position_changed.connect(self.on_position_changed)
        self.player_thread.playback_started.connect(self.on_playback_started)
        self.player_thread.playback_finished.connect(self.on_playback_finished) # 关键连接
        self.player_thread.playback_error.connect(self.on_playback_error)
        
        self.scanner_thread = None
        self.scanner_queue = queue.Queue()
        self.queue_timer = QTimer()
        self.queue_timer.timeout.connect(self.process_scanner_queue)
        self.queue_timer.start(100)
        
        self.converter_thread = None # 不再需要 process 和 queue

        self.command_received.connect(self.process_command)

    # === 新增：你提供的代码，被封装成一个方法 ===
    def _reveal_file_in_explorer(self, file_path):
        normalized_path = os.path.normpath(file_path)
        if not os.path.exists(normalized_path):
            # 在无头应用中，我们不能显示QMessageBox，可以向前端发送错误或打印
            print(f"Error: File path does not exist: {normalized_path}", file=sys.stderr)
            return

        if sys.platform == "win32":
            subprocess.Popen(['explorer', '/select,', normalized_path])
        elif sys.platform == "darwin":
            subprocess.Popen(['open', '-R', normalized_path])
        else:
            directory = os.path.dirname(normalized_path)
            subprocess.Popen(['xdg-open', directory])

    # === 新增：获取音频文件详细信息 ===
    def _get_audio_info(self, file_path):
        """获取音频文件的详细技术信息"""
        try:
            normalized_path = os.path.normpath(file_path)
            if not os.path.isfile(normalized_path):
                return {"error": "文件不存在"}

            # 获取文件基本信息
            file_size = os.path.getsize(normalized_path)
            file_name = os.path.basename(normalized_path)
            
            # 使用 PyAV 获取音频详细信息
            container = av.open(normalized_path)
            audio_stream = container.streams.audio[0]
            
            # 时长
            duration = float(audio_stream.duration * audio_stream.time_base) if audio_stream.duration else 0
            duration_str = f"{int(duration // 60)}:{int(duration % 60):02d}"
            
            # 比特率（从容器或流中获取）
            bitrate = container.bit_rate if container.bit_rate else (audio_stream.bit_rate if audio_stream.bit_rate else 0)
            bitrate_str = f"{bitrate // 1000} kbps" if bitrate > 0 else "未知"
            
            # 采样率
            sample_rate = audio_stream.rate
            sample_rate_str = f"{sample_rate} Hz"
            
            # 声道
            channels = audio_stream.channels
            if channels == 1:
                channels_str = "单声道"
            elif channels == 2:
                channels_str = "立体声"
            else:
                channels_str = f"{channels} 声道"
            
            # 编码器
            codec_name = audio_stream.codec_context.name
            
            # 位深度
            bit_depth = audio_stream.format.bits if audio_stream.format else 0
            bit_depth_str = f"{bit_depth} bit" if bit_depth > 0 else "未知"
            
            # 格式
            format_name = container.format.name
            
            # 文件大小（格式化）
            if file_size < 1024:
                size_str = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_str = f"{file_size / 1024:.2f} KB"
            else:
                size_str = f"{file_size / (1024 * 1024):.2f} MB"
            
            container.close()
            
            return {
                "filename": file_name,
                "filesize": size_str,
                "format": format_name.upper(),
                "duration": duration_str,
                "bitrate": bitrate_str,
                "samplerate": sample_rate_str,
                "channels": channels_str,
                "codec": codec_name.upper(),
                "bitdepth": bit_depth_str,
                "fullpath": normalized_path
            }
            
        except Exception as e:
            return {"error": str(e)}

    def process_scanner_queue(self):
        try:
            message_type, data = self.scanner_queue.get_nowait()
            if message_type == 'chunk':
                # === 决定性修复 1：修正列表添加逻辑 ===
                # 扫描命令已经清空了列表，这里只需要安全地添加
                for file_info in data:
                    self.current_playlist.append(file_info['path'])
                self.send_message("scan-chunk", {"chunk": data})
            elif message_type == 'finished':
                self.send_message("scan-finished", {"count": data})
            elif message_type == 'error':
                self.send_message("scan-error", {"error": data})
        except queue.Empty: pass
        
    # --- 新的转换信号槽 ---
    def on_conversion_progress(self, progress):
        self.send_message("conversion-progress", {"progress": progress})

    def on_conversion_finished(self, data):
        self.send_message("conversion-finished", data)
        self.converter_thread = None # 清理线程
                
    def send_message(self, event_type, data):
        print(json.dumps({"type": event_type, "data": data}), flush=True)

    def on_position_changed(self, pos): self.send_message("position-changed", {"position": pos})
    def on_playback_started(self, path, dur): self.send_message("playback-started", {"path": path, "duration": dur})
    def on_playback_error(self, err): self.send_message("playback-error", {"error": err})

    # --- 播放结束时的核心逻辑 ---
    def on_playback_finished(self):
        if self.loop_mode == LoopMode.LOOP_ONE:
            self.play_current_file()
        elif self.loop_mode == LoopMode.LOOP_LIST:
            self.play_next()
        elif self.loop_mode == LoopMode.NO_LOOP:
            # 尝试播放下一首，如果已经是最后一首，则停止
            if self.current_index < len(self.current_playlist) - 1:
                self.play_next()
            else:
                self.send_message("playback-finished", {}) # 真正结束了
                
            
    def play_current_file(self):
        if 0 <= self.current_index < len(self.current_playlist):
            path = self.current_playlist[self.current_index]
            self.player_thread.interrupt()
            self.player_thread.clear_queue()
            self.player_thread.add_to_queue(path)

    def play_next(self):
        if not self.current_playlist: return
        self.current_index = (self.current_index + 1) % len(self.current_playlist)
        self.play_current_file()

    def play_previous(self):
        if not self.current_playlist: return
        self.current_index = (self.current_index - 1 + len(self.current_playlist)) % len(self.current_playlist)
        self.play_current_file()

    def process_command(self, cmd_data):
        command = cmd_data.get("command")
        data = cmd_data.get("data", {})
        print(f"PYTHON RECEIVED COMMAND (in main thread): {command}", file=sys.stderr, flush=True)

        if command == "scan":
            path = data.get("path")
            if path:
                self.current_playlist = [] # 重置播放列表
                self.current_index = -1
                if self.scanner_thread and self.scanner_thread.isRunning(): self.scanner_thread.stop(); self.scanner_thread.wait()
                self.scanner_thread = FileScannerThread(path, self.scanner_queue); self.scanner_thread.start()
        
        elif command == "play":
            path = data.get("path")
            if path in self.current_playlist:
                self.current_index = self.current_playlist.index(path)
                self.play_current_file()

        elif command == "play-next": self.play_next()
        elif command == "play-previous": self.play_previous()
        
        elif command == "set-loop-mode":
            mode = data.get("mode")
            if mode == "NO_LOOP": self.loop_mode = LoopMode.NO_LOOP
            elif mode == "LOOP_LIST": self.loop_mode = LoopMode.LOOP_LIST
            elif mode == "LOOP_ONE": self.loop_mode = LoopMode.LOOP_ONE

        elif command == "pause": self.player_thread.pause()
        elif command == "unpause": self.player_thread.unpause()
        elif command == "stop":
            self.player_thread.interrupt()
            self.player_thread.clear_queue()
            self.send_message("playback-stopped", {}) # 发送新的 'playback-stopped' 消息
        elif command == "seek":
            pos = data.get("position")
            if pos is not None: self.player_thread.seek(pos)
        elif command == "convert":
            if self.converter_thread and self.converter_thread.isRunning():
                self.send_message("conversion-finished", {"path": None, "error": "另一个转换任务正在进行中。"})
                return
            
            self.converter_thread = ConverterThread(
                data.get("input_path"), data.get("output_path"),
                data.get("format"), data.get("options")
            )
            self.converter_thread.progress.connect(self.on_conversion_progress)
            self.converter_thread.finished.connect(self.on_conversion_finished)
            self.converter_thread.start()
        # === 新增：处理删除文件的命令 ===
        elif command == "delete-files":
            files_to_delete = data.get("paths", [])
            deleted_files = []
            errors = []
            for f_path in files_to_delete:
                try:
                    # === 决定性修复 2：标准化路径 ===
                    normalized_path = os.path.normpath(f_path)
                    if os.path.isfile(normalized_path):
                        os.remove(normalized_path)
                        deleted_files.append(f_path) # 返回原始路径给前端
                        # 从内部播放列表中也移除
                        if f_path in self.current_playlist:
                            self.current_playlist.remove(f_path)
                except OSError as e:
                    errors.append({"path": f_path, "error": str(e)})
            
            if self.player_thread.current_file in deleted_files:
                self.player_thread.interrupt()
                self.send_message("playback-finished", {})

            self.send_message("files-deleted", {"deleted": deleted_files, "errors": errors})
        elif command == "set-volume": # <--- 新增：处理音量命令
            vol = data.get("volume")
            if vol is not None:
                self.player_thread.set_volume(vol)     
        # === 新增：处理 "在文件管理器中显示" 命令 ===
        elif command == "reveal-in-explorer":
            path = data.get("path")
            if path:
                self._reveal_file_in_explorer(path)     
        # === 新增：处理获取文件信息的命令 ===
        elif command == "get-audio-info":
            path = data.get("path")
            if path:
                info = self._get_audio_info(path)
                self.send_message("audio-info", info)                
        elif command == "exit":
            self.player_thread.stop(); self.player_thread.wait(500); QApplication.instance().quit()

# 2. The CommandReader is now a QObject running in a QThread for clean integration
class CommandReader(QObject):
    # We will pass the HeadlessApplication's signal emitter to this object
    command_received = pyqtSignal(dict)
    
    def read_commands_loop(self):
        for line in sys.stdin:
            try:
                cmd_data = json.loads(line)
                # Emit the signal instead of calling the method directly
                self.command_received.emit(cmd_data)
            except (json.JSONDecodeError, Exception) as e:
                print(f"PYTHON ERROR: {e}", file=sys.stderr, flush=True)
        # When stdin closes, quit the app
        QApplication.instance().quit()

if __name__ == "__main__":

    app = QApplication(sys.argv)
    
    headless_app = HeadlessApplication()
    
    # Create a dedicated QThread for reading commands
    command_thread = QThread()
    command_reader = CommandReader()
    
    # Connect the reader's signal to the application's slot
    command_reader.command_received.connect(headless_app.process_command)
    
    # Move the reader to the new thread
    command_reader.moveToThread(command_thread)
    
    # When the thread starts, execute the reading loop
    command_thread.started.connect(command_reader.read_commands_loop)
    
    # Start the thread
    command_thread.start()
    
    sys.exit(app.exec_())