import { WebMWriter } from './webm-writer.js';

// See https://www.webmproject.org/vp9/mp4/
// and also https://googlechrome.github.io/samples/media/vp9-codec-string.html
const vp9_params = {
    profile: 0,
    level: 10,
    bit_depth: 8,
    chroma_subsampling: 1
};
const vp9c = Object.fromEntries(Object.entries(vp9_params).map(
    ([k, v]) => [k, v.toString().padStart(2, '0')]));
const vp9_codec = `vp09.${vp9c.profile}.${vp9c.level}.${vp9c.bit_depth}.${vp9c.chroma_subsampling}`;

const start_el = document.getElementById('start');
const save_el = document.getElementById('save');
const video_el = document.getElementById('video');
const audio_el = document.getElementById('audio');
const msg_el = document.getElementById('msg');

let stopped = false;
let video_loaded = false;
let audio_loaded = false;

function check_start() {
    if (video_loaded && audio_loaded) {
        start_el.addEventListener('click', start);
        start_el.disabled = false;
    }
}

video_el.addEventListener('loadeddata', function () {
    video_loaded = true;
    check_start();
});

audio_el.addEventListener('loadeddata', function () {
    audio_loaded = true;
    check_start();
});

async function start() {
    start_el.disabled = true;

    const writer = new WebMWriter();
    try {
        await writer.start('muxed.webm');
    } catch (ex) {
        start_el.disabled = false;
        throw ex;
    }

    video_el.style.display = 'initial';
    audio_el.style.display = 'initial';

    const video_track = video_el.captureStream().getVideoTracks()[0];
    const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;
    const video_settings = video_track.getSettings();

    const audio_track = audio_el.captureStream().getAudioTracks()[0];
    const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
    const audio_settings = audio_track.getSettings();
    //audio_settings.channelCount etc are undefined!

    function onerror(e) {
        console.error(e);
    }

    let num_exits = 0;

    async function relay_data(ev) {
        const msg = ev.data;
        switch (msg.type) {
            case 'error':
                onerror(msg.detail);
                break;

            case 'exit':
                if (++num_exits === 2) {
                    webm_worker.postMessage({ type: 'end' });
                }
                break;

            default:
                save_el.disabled = stopped;
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

                const cues_at_start = await writer.finish();

                msg_el.innerText = `Finished ${writer.name}: Duration ${writer.duration}ms, Size ${writer.size} bytes, Cues at ${cues_at_start ? 'start' : 'end'}`;

                break;

            case 'start-stream':
                video_worker.postMessage({
                    type: 'start',
                    readable: video_readable,
                    key_frame_interval: 1,
                    config: {
                        codec: vp9_codec,
                        width: 1280,
                        height: 720,
                        bitrate: 2500 * 1000,
                        framerate: video_settings.frameRate
                    }
                }, [video_readable]);

                audio_worker.postMessage({
                    type: 'start',
                    audio: true,
                    readable: audio_readable,
                    config: {
                        codec: 'opus',
                        bitrate: 128 * 1000,
                        sampleRate: 96000,
                        numberOfChannels: 1
                    }
                }, [audio_readable]);

                break;

            case 'muxed-data':
                await writer.write(msg.data);
                msg_el.innerText = `Written ${writer.size} bytes to ${writer.name}`;
                break;

            case 'error':
                onerror(msg.detail);
                break;
        }
    };

    webm_worker.postMessage({
        type: 'start',
        webm_metadata: {
            max_cluster_duration: BigInt(2000000000),
            video: {
                width: 1280,
                height: 720,
                frame_rate: 30,
                codec_id: 'V_VP9',
                ...vp9_params
            },
            audio: {
                bit_depth: 0,
                sample_rate: 48000,
                channels: 2,
                codec_id: 'A_OPUS'
            }
        },
        webm_options: {
            video_queue_limit: 30,
            audio_queue_limit: 16,
            use_audio_timestamps: true
        }
    });

    save_el.addEventListener('click', function () {
        this.disabled = true;
        stopped = true;

        video_track.stop();
        video_el.pause();
        video_el.removeAttribute('src');
        video_el.currentTime = 0;
        video_el.load();

        audio_track.stop();
        audio_el.pause();
        audio_el.removeAttribute('src');
        audio_el.currentTime = 0;
        audio_el.load();
    });
}
