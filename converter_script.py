# converter_script.py (已改造为可导入的模块)
import json
import av # 确保 av 在文件顶部导入

def convert_with_pyav(input_path, output_path, target_format, options_json, progress_callback=None):
    """
    这是一个可被直接调用的转换函数。
    它接受一个回调函数来报告进度。
    成功时返回一个字典，失败时抛出异常。
    """
    try:
        options = json.loads(options_json)
        
        with av.open(input_path) as input_container:
            in_stream = input_container.streams.audio[0]
            # 修复：确保 total_duration 不为零，避免除零错误
            duration_s = in_stream.duration * in_stream.time_base if in_stream.duration else 0
            if duration_s <= 0:
                # 尝试从容器获取总时长
                duration_s = input_container.duration / av.time_base if input_container.duration else 1
            if duration_s <= 0: duration_s = 1 # 最后的保险

            with av.open(output_path, mode='w') as output_container:
                # 你的所有转换逻辑 (mp3, wav, flac) 保持完全不变
                # ...
                # 这里为了简洁省略了你的 if/else 逻辑，直接复制粘贴你原来的即可
                # 关键是下面的进度报告部分
                if target_format == 'mp3':
                    MP3_SUPPORTED_RATES = {8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000}
                    target_rate = in_stream.rate if in_stream.rate in MP3_SUPPORTED_RATES else 44100
                    out_stream = output_container.add_stream(target_format, rate=target_rate)
                    if 'b:a' in options: out_stream.codec_context.bit_rate = int(options['b:a'].replace('k', '')) * 1000
                    resampler = av.AudioResampler(format=out_stream.codec_context.format.name, layout=out_stream.layout.name, rate=out_stream.rate)
                    last_progress = -1
                    for in_frame in input_container.decode(in_stream):
                        for out_frame in resampler.resample(in_frame):
                            for packet in out_stream.encode(out_frame): output_container.mux(packet)
                        
                        # === 关键改动：调用回调函数 ===
                        current_time_s = in_frame.pts * in_stream.time_base if in_frame.pts else 0
                        progress = int((current_time_s / duration_s) * 100)
                        if progress > last_progress and progress_callback:
                            progress_callback(progress) # 调用回调
                            last_progress = progress
                            
                    for out_frame in resampler.resample(None):
                        for packet in out_stream.encode(out_frame): output_container.mux(packet)
                    for packet in out_stream.encode(None): output_container.mux(packet)
                else: # wav, flac
                    codec_name = 'pcm_s16le' if target_format == 'wav' else 'flac'
                    out_stream = output_container.add_stream(codec_name, rate=in_stream.rate)
                    last_progress = -1
                    for frame in input_container.decode(in_stream):
                        for packet in out_stream.encode(frame): output_container.mux(packet)

                        # === 关键改动：调用回调函数 ===
                        current_time_s = frame.pts * frame.time_base if frame.pts else 0
                        progress = int((current_time_s / duration_s) * 100)
                        if progress > last_progress and progress_callback:
                            progress_callback(progress) # 调用回调
                            last_progress = progress
                            
                    for packet in out_stream.encode(None): output_container.mux(packet)

        if progress_callback:
            progress_callback(100) # 确保最后发送100%
        
        # 成功时返回结果
        return {'path': output_path, 'error': None}

    except Exception as e:
        # 失败时向上抛出异常，让调用者处理
        import traceback
        raise Exception(str(traceback.format_exc()))

# if __name__ == '__main__': 部分可以删除，因为它不再被独立运行
