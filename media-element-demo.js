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

const save_el = document.getElementById('save');
const video_el = document.getElementById('video');
const audio_el = document.getElementById('audio');

let stopped = false;
let video_loaded = false;
let audio_loaded = false;

video_el.addEventListener('loadeddata', function () {
    video_loaded = true;
    if (audio_loaded) {
        start();
    }
});

audio_el.addEventListener('loadeddata', function () {
    audio_loaded = true;
    if (video_loaded) {
        start();
    }
});

function start() {
    const video_track = video_el.captureStream().getVideoTracks()[0];
    const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;

    const audio_track = audio_el.captureStream().getAudioTracks()[0];
    const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
    const audio_settings = audio_track.getSettings();
    //audio_settings.channelCount etc are undefined!

    function onerror(e) {
        console.error(e);
    }

    let num_exits = 0;

    function relay_data(ev) {
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

    const chunks = [];

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

                const blob = new Blob(chunks, { type: 'video/webm' });

                // From https://github.com/muaz-khan/RecordRTC/blob/master/RecordRTC.js#L1906
                // EBML.js copyright goes to: https://github.com/legokichi/ts-ebml

                const reader = new EBML.Reader();
                const decoder = new EBML.Decoder();

                const buf = await blob.arrayBuffer();
                const elms = decoder.decode(buf);
                for (let elm of elms) {
                    reader.read(elm);
                }
                reader.stop();
                console.log(`Duration: ${reader.duration}`);
                const refinedMetadataBuf = EBML.tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
                console.log(`Indexed ${blob.size} bytes`);

                const body = buf.slice(reader.metadataSize);
                const blob2 = new Blob([refinedMetadataBuf, body], {
                    type: 'video/webm'
                });

                const a = document.createElement('a');
                const filename = 'muxed.webm';
                a.textContent = filename;
                a.href = URL.createObjectURL(blob2);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

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
                        bitrate: 2500 * 1000
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
                chunks.push(msg.data);
                break;

            case 'error':
                onerror(msg.detail);
                break;
        }
    };

    webm_worker.postMessage({
        type: 'start',
        webm_metadata: {
            max_segment_duration: BigInt(1000000000),
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
