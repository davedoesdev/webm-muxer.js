function onerror(e) {
    console.error(e);
    self.postMessage({
        type: 'error',
        detail: e.message
    });
}

onmessage = async function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'start':
            try {
                const Encoder = AudioEncoder;
                const type = 'audio-data';
                const key_frame_interval = 0;
                let encoder;
                if (msg.config.codec !== 'pcm') {
                    encoder = new Encoder({
                        output: chunk => {
                            const data = new ArrayBuffer(chunk.byteLength);
                            chunk.copyTo(data);
                            self.postMessage({
                                type,
                                timestamp: chunk.timestamp,
                                duration: chunk.duration,
                                is_key: msg.audio || chunk.type === 'key',
                                data
                            }, [data]);
                        },
                        error: onerror
                    });
                    await encoder.configure(msg.config);
                }

                const reader = msg.readable.getReader();
                let last_key_frame = -1;

                while (true) {
                    const result = await reader.read();
                    if (result.done) {
                        if (encoder) {
                            await encoder.flush();
                        }
                        self.postMessage({ type: 'exit' });
                        break;
                    }
                    if (msg.audio) {
                        if (encoder) {
                            encoder.encode(result.value);
                        } else if (result.value.format !== 'f32-planar') {
                            throw new Error(`unexpected audio format: ${result.value.format}`);
                        } else {
                            // Convert from planar to interleaved
                            const nc = result.value.numberOfChannels;
                            let total_size = 0;
                            const bufs = [];
                            for (let i = 0; i < nc; ++i) {
                                const options = { planeIndex: i };
                                const size = result.value.allocationSize(options);
                                total_size += size;
                                const buf = new ArrayBuffer(size);
                                result.value.copyTo(buf, options);
                                bufs.push(buf);
                            }
                            const data = new ArrayBuffer(total_size);
                            const buf = new Uint8Array(data);
                            for (let i = 0; i < total_size; i += 4) {
                                const d = i / 4;
                                buf.set(new Uint8Array(bufs[Math.floor(d) % nc], Math.floor(d / nc) * 4, 4), i);
                            }
                            self.postMessage({
                                type,
                                timestamp: result.value.timestamp,
                                duration: result.value.duration,
                                is_key: true,
                                data
                            }, [data]);
                        }
                    }
                    result.value.close();
                }
            } catch (ex) {
                onerror(ex);
            }

            break;
    }
};
