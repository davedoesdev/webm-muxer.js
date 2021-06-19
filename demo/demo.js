function onerror(e) {
    console.error(e);
}

const start_el = document.getElementById('start');
start_el.addEventListener('click', async function () {
    this.disabled = true;

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
                    config: {
                        codec: 'avc1.42E01E',
                        bitrate: 2500 * 1000,
                        width: video_settings.width,
                        height: video_settings.height,
                        avc: {
                            format: 'annexb'
                        }
                    }
                }, [video_readable]);

                audio_worker.postMessage({
                    audio: true,
                    type: 'start',
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
                console.log("GOT MUXED DATA", msg.data);
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
                width: video_settings.width,
                height: video_settings.height,
                frame_rate: video_settings.frameRate,
                codec_id: 'V_MPEG4/ISO/AVC'
            },
            audio: {
                sample_rate: audio_settings.sampleRate,
                channles: audio_settings.channelCount,
                codec_id: 'A_OPUS'
            }
        }
    });
});
