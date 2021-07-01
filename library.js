mergeInto(LibraryManager.library, {
    emscripten_read_async: function (buf, size) {
        if (!self.stream_initialized) {
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
            self.stream_exit = function () {
                if (self.webm_exited &&
                    (!self.stream_destination || self.stream_destination_exited)) {
                    self.postMessage({
                        type: 'exit',
                        code: self.stream_destination_exit_code || self.webm_exit_code
                    });
                }
            }
            self.onmessage = function (e) {
                const msg = e['data'];
                switch (msg['type']) {
                    case 'start':
                        if (msg['webm_destination']) {
                            self.stream_destination = new Worker(msg['webm_destination']);
                            delete msg['webm_destination'];
                            self.stream_destination.onmessage = function (e) {
                                const msg2 = e['data'];
                                switch (msg2['type']) {
                                    case 'ready':
                                        self.stream_destination.postMessage(msg);
                                        break;

                                    case 'exit':
                                        self.stream_destination_exited = true;
                                        self.stream_destination_exit_code = msg2['code'];
                                        self.stream_destination.terminate();
                                        self.stream_exit();
                                        break;

                                    default:
                                        self.postMessage(msg2, msg2['transfer']);
                                        break;
                                }
                            };
                            self.data_destination = self.stream_destination;
                        } else {
                            self.postMessage({type: 'start-stream'});
                            self.data_destination = self;
                        }
                        break;
                    case 'end':
                        if (self.stream_destination) {
                            self.stream_destination.postMessage(msg);
                        }
                        // falls through
                    case 'stream-data':
                        self.stream_queue.push(new Uint8Array(msg['data']));
                        if (self.stream_handler) {
                            self.stream_process();
                        }
                        break;
                }
            };
            self.postMessage({type: 'ready'});
            self.stream_initialized = true;
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
        self.data_destination.postMessage({
            type: 'muxed-data',
            data
        }, [data]);
        return size;
    },
    emscripten_exit: function (code) {
        self.webm_exited = true;
        self.webm_exit_code = code;
        self.stream_exit();
        return code;
    }
});
