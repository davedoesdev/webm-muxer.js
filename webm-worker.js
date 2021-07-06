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
            webm_muxer.postMessage(msg);
            break;
        }
    }
};


