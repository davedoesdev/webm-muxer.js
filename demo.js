function onerror(e) {
    console.error(e);
}

document.getElementById('start').addEventListener('click', async function () {
    this.disabled = true;

    const info = document.getElementById('info');
    info.innerText = 'Buffering';

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
            width: 1280,
            height: 720,
            frameRate: {
                ideal: 30,
                max: 30
            }
        }
    });

    const video_track = stream.getVideoTracks()[0];
    const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;
    const video_settings = video_track.getSettings();

    const audio_track = stream.getAudioTracks()[0];
    const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
    const audio_settings = audio_track.getSettings();

    function relay_data(ev) {
        const msg = ev.data;
        if (msg.type === 'error') {
            onerror(msg.detail);
        } else {
            webm_worker.postMessage(msg, [msg.data]);
        }
    }

    const video_worker = new Worker('./encoder-worker.js');
    video_worker.onerror = onerror;
    video_worker.onmessage = relay_data;

    const audio_worker = new Worker('./encoder-worker.js');
    audio_worker.onerror = onerror;
    audio_worker.onmessage = relay_data;

    let buffer;
    let queue = [];
    const key_frame_interval = 10;
    const buffer_delay = 2;

    const webm_worker = new Worker('./webm-worker.js');
    webm_worker.onerror = onerror;
    webm_worker.onmessage = ev => {
        const msg = ev.data;
        switch (msg.type) {
            case 'exit':
                if (msg.code !== 0) {
                    onerror(`muxer exited with status ${msg.code}`);
                }
                webm_worker.terminate();
                video_worker.terminate();
                audio_worker.terminate();
                break;

            case 'start-stream':
                video_worker.postMessage({
                    type: 'start',
                    readable: video_readable,
                    key_frame_interval,
                    config: {
                        //codec: 'avc1.42E01E',
                        codec: 'vp09.00.10.08',
                        bitrate: 2500 * 1000,
                        width: video_settings.width,
                        height: video_settings.height
                        /*avc: {
                            format: 'annexb'
                        }*/
                    }
                }, [video_readable]);

                audio_worker.postMessage({
                    type: 'start',
                    audio: true,
                    readable: audio_readable,
                    config: {
                        codec: 'opus',
                        bitrate: 128 * 1000,
                        sampleRate: audio_settings.sampleRate,
                        numberOfChannels: audio_settings.channelCount
                    }
                }, [audio_readable]);

                break;

            case 'muxed-data':
                queue.push(msg.data);
                if (!buffer.updating) {
                    remove_append();
                }
                break;

            case 'error':
                onerror(msg.detail);
                break;
        }
    };

    function remove_append() {
        const range = buffer.buffered;
        if (range.length > 0) {
            info.innerText = `Buffered ${range.start(0)} .. ${range.end(0)}`;
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

    const video = document.getElementById('video');
    video.onerror = () => onerror(video.error);

    const source = new MediaSource();
    video.src = URL.createObjectURL(source);

    source.addEventListener('sourceopen', function () {
        buffer = this.addSourceBuffer('video/webm; codecs=vp9,opus');
        buffer.addEventListener('updateend', remove_append);

        webm_worker.postMessage({
            type: 'start',
            webm_metadata: {
                max_segment_duration: BigInt(1000000000),
                video: {
                    width: video_settings.width,
                    height: video_settings.height,
                    frame_rate: video_settings.frameRate,
                    //codec_id: 'V_MPEG4/ISO/AVC'
                    codec_id: 'V_VP9'
                },
                audio: {
                    sample_rate: audio_settings.sampleRate,
                    channels: audio_settings.channelCount,
                    codec_id: 'A_OPUS'
                }
            }
        });
    });
});
