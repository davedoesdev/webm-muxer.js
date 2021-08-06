const video_flag = 0b01;
const audio_flag = 0b10;

function onerror(e) {
    console.error(e);
    self.postMessage({
        type: 'error',
        detail: e.message
    });
}

let metadata;
let webm_muxer;
let first_video_timestamp = null;
let first_audio_timestamp = null;
let last_timestamp = -1;
let queued_audio = [];

function send_data(data) {
    webm_muxer.postMessage({
        type: 'stream-data',
        data
    }, [data]);
}

function send_msg(msg) {
    if (msg.timestamp <= last_timestamp) {
        msg.timestamp = last_timestamp + 1;
    }
    last_timestamp = msg.timestamp;

    const header = new ArrayBuffer(2);
    const view = new DataView(header);
    view.setUint8(0, msg.type === 'video-data' ? 0 : 1);
    view.setUint8(1, msg.is_key ? 1 : 0);

    const timestamp = new ArrayBuffer(8);
    new DataView(timestamp).setBigUint64(0, BigInt(msg.timestamp), true);

    const duration = new ArrayBuffer(8);
    new DataView(duration).setBigUint64(0, BigInt(msg.duration || 0), true);

    send_data(header);
    send_data(timestamp);
    send_data(duration);
    send_data(msg.data);
}

function send_metadata(metadata) {
    const max_cluster_duration = new ArrayBuffer(8);
    new DataView(max_cluster_duration).setBigUint64(0, metadata.max_segment_duration || BigInt(0), true);;
    send_data(max_cluster_duration);

    const flags = new ArrayBuffer(1);
    new DataView(flags).setUint8(0,(metadata.video ? video_flag : 0) | (metadata.audio ? audio_flag : 0), true);
    send_data(flags);

    if (metadata.video) {
        const width = new ArrayBuffer(4);
        new DataView(width).setInt32(0, metadata.video.width, true);
        send_data(width);

        const height = new ArrayBuffer(4);
        new DataView(height).setInt32(0, metadata.video.height, true);
        send_data(height);

        const frame_rate = new ArrayBuffer(4);
        new DataView(frame_rate).setFloat32(0, metadata.video.frame_rate || 0, true);
        send_data(frame_rate);

        send_data(new TextEncoder().encode(metadata.video.codec_id).buffer);

        if (metadata.video.codec_id === 'V_VP9') {
            // See https://www.webmproject.org/docs/container/#vp9-codec-feature-metadata-codecprivate
            const codec_private = new ArrayBuffer(12);
            const view = new DataView(codec_private);
            view.setUint8(0, 1); // profile
            view.setUint8(1, 1); // length
            view.setUint8(2, metadata.video.profile || 0);
            view.setUint8(3, 2); // level
            view.setUint8(4, 1); // length
            view.setUint8(5, metadata.video.level || 10);
            view.setUint8(6, 3); // bit depth
            view.setUint8(7, 1); // length
            view.setUint8(8, metadata.video.bit_depth || 8);
            view.setUint8(9, 4); // chroma subsampling
            view.setUint8(10, 1); // length
            view.setUint8(11, metadata.video.chrome_subsampling || 1);
            send_data(codec_private);
        } else {
            send_data(new ArrayBuffer(0));
        }

        const seek_pre_roll = new ArrayBuffer(8);
        new DataView(seek_pre_roll).setBigUint64(0, metadata.video.seek_pre_roll || BigInt(0), true);
        send_data(seek_pre_roll);
    }

    if (metadata.audio) {
        const sample_rate = new ArrayBuffer(4);
        new DataView(sample_rate).setInt32(0, metadata.audio.sample_rate, true);
        send_data(sample_rate);

        const channels = new ArrayBuffer(4);
        new DataView(channels).setInt32(0, metadata.audio.channels, true);
        send_data(channels);

        const bit_depth = new ArrayBuffer(4);
        new DataView(bit_depth).setInt32(0, metadata.audio.bit_depth || 0, true);
        send_data(bit_depth);

        send_data(new TextEncoder().encode(metadata.audio.codec_id).buffer);

        if (metadata.audio.codec_id === 'A_OPUS') {
            // Adapted from https://github.com/kbumsik/opus-media-recorder/blob/master/src/ContainerInterface.cpp#L27
            // See also https://datatracker.ietf.org/doc/html/rfc7845#section-5.1

            const codec_private = new ArrayBuffer(19);
            new TextEncoder().encodeInto('OpusHead', new Uint8Array(codec_private)); // magic

            const view = new DataView(codec_private);
            view.setUint8(8, 1); // version
            view.setUint8(9, metadata.audio.channels); // channel count
            view.setUint16(10, metadata.audio.pre_skip || 0, true); // pre-skip
            view.setUint32(12, metadata.audio.sample_rate, true); // sample rate
            view.setUint16(16, metadata.audio.output_gain || 0, true); // output gain
            view.setUint8(18, 0, true); // mapping family

            send_data(codec_private);
        } else {
            send_data(new ArrayBuffer(0));
        }

        const seek_pre_roll = new ArrayBuffer(8);
        new DataView(seek_pre_roll).setBigUint64(0,
                metadata.audio.seek_pre_roll || BigInt(metadata.audio.codec_id === 'A_OPUS' ? 80000 : 0),
                true);
        send_data(seek_pre_roll);
    }

    self.postMessage({type: 'start-stream'});
}

onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'video-data':
            if (metadata.video) {
                if (first_video_timestamp === null) {
                    first_video_timestamp = msg.timestamp;
                }
                msg.timestamp -= first_video_timestamp;

                while ((queued_audio.length > 0) &&
                       (queued_audio[0].timestamp <= msg.timestamp)) {
                    send_msg(queued_audio.shift());
                }
                send_msg(msg);
            }
            break;

        case 'audio-data':
            if (metadata.audio) {
                if (first_audio_timestamp === null) {
                    first_audio_timestamp = msg.timestamp;
                }
                msg.timestamp -= first_audio_timestamp;
                if (metadata.video) {
                    queued_audio.push(msg);
                } else {
                    send_msg(msg);
                }
            }
            break;

        case 'start': {
            metadata = msg.webm_metadata;
            delete msg.webm_metadata;

            webm_muxer = new Worker('./webm-muxer.js');
            webm_muxer.onerror = onerror;

            webm_muxer.onmessage = function (e) {
                const msg2 = e.data;
                switch (msg2.type) {
                    case 'ready':
                        webm_muxer.postMessage(msg);
                        break;

                    case 'start-stream':
                        send_metadata(metadata);
                        break;

                    case 'exit':
                        webm_muxer.terminate();
                        self.postMessage(msg2);
                        break;

                    case 'muxed-data':
                        self.postMessage(msg2, [msg2.data]);
                        break;

                    default:
                        self.postMessage(msg2, msg2.transfer);
                        break;
                }
            };

            break;
        }

        case 'end': {
            if (webm_muxer) {
                webm_muxer.postMessage(msg);
            }
            break;
        }
    }
};
