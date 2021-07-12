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
            self.onmessage = async function (e) {
                const msg = e['data'];
                switch (msg['type']) {
                    case 'start':
                        self.muxed_metadata = msg['muxed_metadata'];
                        if (msg['webm_destination']) {
                            const WebMDestination = (await import(msg['webm_destination']))['WebMDestination'];
                            self.stream_destination = new WebMDestination();
                            delete msg['webm_destination'];
                            self.stream_destination['addEventListener']('message', function (e) {
                                const msg2 = e.detail;
                                switch (msg2['type']) {
                                    case 'ready':
                                        this.start(msg);
                                        break;

                                    case 'exit':
                                        self.stream_destination_exited = true;
                                        self.stream_destination_exit_code = msg2['code'];
                                        self.stream_exit();
                                        break;

                                    default:
                                        self.postMessage(msg2, msg2['transfer']);
                                        break;
                                }
                            });
                        } else {
                            self.postMessage({type: 'start-stream'});
                        }
                        break;
                    case 'end':
                        if (self.stream_destination) {
                            self.stream_destination['end'](msg);
                        }
                        if ((self.stream_queue.length > 0) &&
                            (self.stream_queue[0].length === 0)) {
                            break;
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
        if (self.stream_destination) {
            self.stream_destination['muxed_data'](data, self.muxed_metadata);
        } else {
            self.postMessage(Object.assign({
                type: 'muxed-data',
                data
            }, self.muxed_metadata), [data]);
        }
        return size;
    },
    emscripten_exit: function (code) {
        self.webm_exited = true;
        self.webm_exit_code = code;
        self.stream_exit();
        return code;
    }
});
