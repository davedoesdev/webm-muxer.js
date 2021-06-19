function onerror(e) {
    console.error(e);
    self.postMessage({
        type: 'error',
        detail: e
    });
}

onmessage = async function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'start':
            try {
                const Encoder = msg.audio ? AudioEncoder : VideoEncoder;
                const type = msg.audio ? 'audio-data' : 'video-data';
                const encoder = new Encoder({
                    output: chunk => {
                        //const data = new ArrayBuffer(chunk.byteLength);
                        //chunk.copyTo(data);
                        const data = chunk.data.slice(0, chunk.byteLength);
                        self.postMessage({
                            type,
                            timestamp: chunk.timestamp,
                            is_key: chunk.type === 'key',
                            data
                        }, [data]);
                    },
                    error: onerror
                });
                
                await encoder.configure(msg.config);

                const reader = msg.readable.getReader();

                while (true) {
                    const result = await reader.read();
                    if (result.done) {
                        break;
                    }
                    encoder.encode(result.value);
                    result.value.close();
                }
            } catch (ex) {
                onerror(ex);
            }

            break;
    }
};
