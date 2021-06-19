const webm_muxer = new Worker('./webm-muxer.js');

function onerror(e) {
    console.error(e);
    self.postMessage({
        type: 'error',
        detail: e
    });
}

webm_muxer.onerror = onerror;

let metadata;
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
    const dv = new DataView(header);
    dv.setUint8(0, msg.type === 'video-data' ? 0 : 1);
    dv.setUint8(1, msg.is_key ? 1 : 0);

    const ts = new ArrayBuffer(8);
    new DataView(ts).setBigInt64(0, BigInt(msg.timestamp), true);

    send_data(header);
    send_data(ts);
    send_data(msg.data);
}

function send_metadata() {
    const max_cluster_duration = new ArrayBuffer(8);
    new DataView(max_cluster_duration).setBigUint64(0, metadata.max_segment_duration || 0, true);;
    send_data(max_cluster_duration);

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

    self.postMessage({type: 'start-stream'});
}

onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'video-data':
        case 'audio-data':
            if (msg.type === 'video-data') {
                if (first_video_timestamp === null) {
                    first_video_timestamp = msg.timestamp;
                }
                msg.timestamp -= first_video_timestamp;

                while ((queued_audio.length > 0) &&
                       (queued_audio[0].timestamp <= msg.timestamp)) {
                    send_msg(queued_audio.shift());
                }
                send_msg(msg);
            } else {
                if (first_audio_timestamp === null) {
                    first_audio_timestamp = msg.timestamp;
                }
                msg.timestamp -= first_audio_timestamp;

                queued_audio.push(msg);
            }

            break;

        case 'start': 
            metadata = msg.webm_metadata;
            break;
    }
};

webm_muxer.onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'start-stream':
            send_metadata();
            break;

        case 'exit':
            self.postMessage(msg);
            break;

        case 'muxed-data':
            self.postMessage(msg, [msg.data]);
            break;
    }
};
