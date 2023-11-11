import {
    max_video_config,
} from './resolution.js';

import { WebMWriter } from './webm-writer.js';

function onerror(e) {
    console.error(e);
}

const start_el = document.getElementById('start');
const stop_el = document.getElementById('stop');
const record_el = document.getElementById('record');
const pcm_el = document.getElementById('pcm');
const inmem_el = document.getElementById('in-memory');
const codec_el = document.getElementById('codec');
const chroma_el = document.getElementById('chroma');
let video_track, audio_track;

const video = document.getElementById('video');
video.onerror = () => onerror(video.error);
const poster = video.poster;

record_el.addEventListener('input', function () {
    if (this.checked) {
        pcm_el.disabled = false;
        pcm_el.checked = pcm_el.was_checked;
        inmem_el.disabled = false;
        inmem_el.checked = inmem_el.was_checked;
    } else {
        pcm_el.disabled = true;
        pcm_el.was_checked = pcm_el.checked;
        pcm_el.checked = false;
        inmem_el.disabled = true;
        inmem_el.was_checked = inmem_el.checked;
        inmem_el.checked = false;
    }
});
pcm_el.disabled = true;
inmem_el.disabled = true;

start_el.addEventListener('click', async function () {
    // See https://www.webmproject.org/vp9/mp4/
    // and also https://googlechrome.github.io/samples/media/vp9-codec-string.html
    const vp9_params = {
        profile: 0,
        level: 10,
        bit_depth: 8,
        chroma_subsampling: chroma_el.value ? 2 : 1
    };
    const vp9c = Object.fromEntries(Object.entries(vp9_params).map(
        ([k, v]) => [k, v.toString().padStart(2, '0')]));
    const vp9_codec = `vp09.${vp9c.profile}.${vp9c.level}.${vp9c.bit_depth}.${vp9c.chroma_subsampling}`;

    // See https://github.com/ietf-wg-cellar/matroska-specification/blob/master/codec/av1.md
    // and also https://aomediacodec.github.io/av1-isobmff/#codecsparam
    const av1_params = {
        profile: 0,
        level: 0,
        tier: 0,
        high_bitdepth: false,
        twelve_bit: false,
        monochrome: false,
        chroma_subsampling_x: !!chroma_el.value,
        chroma_subsampling_y: !!chroma_el.value,
        chroma_sample_position: 0,
    };
    const av1_bitdepth = 8 + av1_params.high_bitdepth * (av1_params.profile === 2 && av1_params.twelve_bit ? 4 : 2)
    const av1_codec = `av01.${av1_params.profile}.${av1_params.level.toString().padStart(2, '0')}${av1_params.tier === 0 ? 'M' : 'H'}.${av1_bitdepth.toString().padStart(2, '0')}`;//.${av1_params.chroma_subsampling_x+0}${av1_params.chroma_subsampling_y+0}${av1_params.chroma_sample_position}`;

    this.disabled = true;
    record_el.disabled = true;
    pcm_el.disabled = true;
    inmem_el.disabled = true;

    let writer;
    const rec_info = document.getElementById('rec_info');
    if (record_el.checked) {
        writer = new WebMWriter();
        try {
            await writer.start(inmem_el.checked ? null : 'camera.webm');
        } catch (ex) {
            this.disabled = false;
            record_el.disabled = false;
            pcm_el.disabled = !record_el.checked;
            inmem_el.disabled = !record_el.checked;
            throw ex;
        }
        rec_info.innerText = 'Recording';
    } else {
        rec_info.innerText =  '';
    }

    const buf_info = document.getElementById('buf_info');
    if (!pcm_el.checked) {
        buf_info.innerText = 'Buffering';
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          channelCount: 2
        },
        video: {
            width: 4096,
            height: 2160,
            frameRate: {
                ideal: 30,
                max: 30
            }
        }
    });

    video_track = stream.getVideoTracks()[0];
    const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;
    const video_settings = video_track.getSettings();

    const codec = codec_el.options[codec_el.selectedIndex].value;

    const encoder_constraints = {
        //codec: 'avc1.42E01E',
        codec: codec === 'av01' ? av1_codec : vp9_codec,
        width: video_settings.width,
        height: video_settings.height,
        bitrate: 2500 * 1000,
        framerate: video_settings.frameRate,
        latencyMode: 'realtime',
        /*avc: {
            format: 'annexb'
        }*/
    };

    const video_encoder_config = await max_video_config({
        ...encoder_constraints,
        ratio: video_settings.width / video_settings.height
    }) || await max_video_config(encoder_constraints);

    console.log(`video resolution: ${video_settings.width}x${video_settings.height}`);
    console.log(`encoder resolution: ${video_encoder_config.width}x${video_encoder_config.height}`);

    audio_track = stream.getAudioTracks()[0];
    const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
    const audio_settings = audio_track.getSettings();

    let num_exits = 0;

    function relay_data(ev) {
        const msg = ev.data;
        switch (msg.type) {
            case 'error':
                onerror(msg.detail)
                break;

            case 'exit':
                if (++num_exits === 2) {
                    webm_worker.postMessage({ type: 'end' });
                }
                break;

            default:
                webm_worker.postMessage(msg, [msg.data]);
                break;
        }
    }

    const video_worker = new Worker('./encoder-worker.js');
    video_worker.onerror = onerror;
    video_worker.onmessage = relay_data;

    const audio_worker = new Worker('./encoder-worker.js');
    audio_worker.onerror = onerror;
    audio_worker.onmessage = relay_data;

    let exited = false;
    let buffer;
    const queue = [];
    const key_frame_interval = 1;
    const buffer_delay = 2;

    const webm_worker = new Worker('./webm-worker.js');
    webm_worker.onerror = onerror;
    webm_worker.onmessage = async ev => {
        const msg = ev.data;
        switch (msg.type) {
            case 'exit':
                if (msg.code !== 0) {
                    onerror(`muxer exited with status ${msg.code}`);
                }
                webm_worker.terminate();
                video_worker.terminate();
                audio_worker.terminate();
                exited = true;
                remove_append();

                if (record_el.checked) {
                    const r = await writer.finish();
                    rec_info.innerText = `Finished: Duration ${writer.duration}ms, Size ${writer.size} bytes`;
                    if (inmem_el.checked) {
                        const blob = new Blob(r, { type: 'video/webm' });
                        const a = document.createElement('a');
                        const filename = 'camera.webm';
                        a.textContent = filename;
                        a.href = URL.createObjectURL(blob);
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    } else {
                        rec_info.innerText += `, Filename ${writer.name}, Cues at ${r ? 'start' : 'end'}`;
                    }
                }

                start_el.disabled = false;
                record_el.disabled = false;
                pcm_el.disabled = !record_el.checked;
                inmem_el.disabled = !record_el.checked;

                break;

            case 'start-stream':
                video_worker.postMessage({
                    type: 'start',
                    readable: video_readable,
                    key_frame_interval,
                    config: video_encoder_config
                }, [video_readable]);

                audio_worker.postMessage({
                    type: 'start',
                    audio: true,
                    readable: audio_readable,
                    config: {
                        codec: pcm_el.checked ? 'pcm' : 'opus',
                        bitrate: 128 * 1000,
                        sampleRate: audio_settings.sampleRate,
                        numberOfChannels: audio_settings.channelCount
                    }
                }, [audio_readable]);

                stop_el.disabled = false;

                break;

            case 'muxed-data':
                if (record_el.checked) {
                    await writer.write(msg.data);
                    rec_info.innerText = `Recorded ${writer.size} bytes`;
                }
                queue.push(msg.data);
                if (!pcm_el.checked) {
                    remove_append();
                }
                break;

            case 'stats':
                console.log(msg.data);
                break;

            case 'error':
                onerror(msg.detail);
                break;
        }
    };

    function remove_append() {
        if (buffer && buffer.updating) {
            return;
        }
        if (exited) {
            if (video.src) {
                buffer.removeEventListener('updateend', remove_append);
                buf_info.innerText = '';
                source.endOfStream();
                video.pause();
                video.removeAttribute('src');
                video.currentTime = 0;
                video.poster = poster;
                video.load();
            }
            return;
        }
        const range = buffer.buffered;
        if (range.length > 0) {
            buf_info.innerText = `Buffered ${range.start(0)} .. ${range.end(0)}`;
        }
        if ((video.currentTime === 0) &&
            ((buffer_delay === 0) ||
             ((range.length > 0) && (range.end(0) > buffer_delay)))) {
            video.poster = '';
            video.play();
        }
        const check = video.currentTime - key_frame_interval * 2;
        if ((range.length > 0) && (range.start(0) < check)) {
            buffer.remove(0, check);
        } else if (queue.length > 0) {
            buffer.appendBuffer(queue.shift());
        }
    }

    function start() {
        webm_worker.postMessage({
            type: 'start',
            webm_stats_interval: 1000,
            //webm_receiver: './test-receiver.js',
            webm_metadata: {
                max_cluster_duration: BigInt(2000000000),
                video: {
                    width: video_encoder_config.width,
                    height: video_encoder_config.height,
                    frame_rate: video_settings.frameRate,
                    //codec_id: 'V_MPEG4/ISO/AVC'
                    codec_id: codec === 'av01' ? 'V_AV1' : 'V_VP9',
                    ...(codec === 'av01' ? av1_params : vp9_params)
                },
                audio: {
                    bit_depth: pcm_el.checked ? 32 : 0,
                    sample_rate: audio_settings.sampleRate,
                    channels: audio_settings.channelCount,
                    codec_id: pcm_el.checked ? 'A_PCM/FLOAT/IEEE' : 'A_OPUS'
                }
            }
        });
    }

    if (pcm_el.checked) {
        return start();
    }

    const source = new MediaSource();
    video.src = URL.createObjectURL(source);

    source.addEventListener('sourceopen', function () {
        buffer = this.addSourceBuffer(`video/webm; codecs=${codec === 'av01' ? av1_codec : vp9_codec},opus`);
        buffer.addEventListener('updateend', remove_append);
        start();
    });
});

stop_el.addEventListener('click', async function () {
    this.disabled = true;
    video_track.stop();
    audio_track.stop();
});
