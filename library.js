mergeInto(LibraryManager.library, {
    emscripten_read_async: function (buf, size) {
        if (!self.stream_started) {
            self.stream_queue = [];
            self.stream_handler = null;
            self.stream_buf = null;
            self.stream_size = null;
            self.stream_process = function () {
                if (self.stream_queue.length > 0) {
                    const head = self.stream_queue.shift();
                    let r = -1;
                    if (head.length <= self.stream_size) {
                        r = head.length;
                        HEAPU8.set(head, self.stream_buf);
                    }
                    const handler = self.stream_handler;
                    self.stream_handler = null;
                    self.stream_buf = null;
                    self.stream_size = null;
                    handler(r);
                }
            };
            self.onmessage = function (e) {
                const msg = e.data;
                switch (msg.type) {
                    case 'stream-data':
                        self.stream_queue.push(new Uint8Array(msg.data));
                        if (self.stream_handler) {
                            self.stream_process();
                        }
                        break;
                }
            };
            self.postMessage({type: 'start-stream'});
            self.stream_started = true;
        };
        return Asyncify.handleSleep(wakeUp => {
            if (size <= 0) {
                return wakeUp(0);
            }
            self.stream_handler = wakeUp;
            self.stream_buf = buf;
            self.stream_size = size;
            self.stream_process();
        });
    },
    emscripten_write: function (buf, size) {
        const data = HEAPU8.slice(buf, buf + size).buffer;
        self.postMessage({
            type: 'muxed-data',
            data
        }, [data]);
        return size;
    },
    emscripten_exit: function (code) {
        self.postMessage({
            type: 'exit',
            code
        });
        return code;
    }
});
