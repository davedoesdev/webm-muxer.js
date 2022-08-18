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
            self.stream_exit = function (code) {
                if (self.stats_timer) {
                    clearInterval(self.stats_timer);
                }
                self.postMessage({
                    type: 'exit',
                    code
                });
            }
            self.onmessage = async function (e) {
                const msg = e['data'];
                switch (msg['type']) {
                    case 'start':
                        if (msg['webm_stats_interval']) {
                            self.stats_timer = setInterval(() => {
                                self.postMessage({
                                    type: 'stats',
                                    data: {memory: HEAPU8.length}
                                });
                            }, msg['webm_stats_interval']);
                        }
                        self.webm_receiver_data = msg['webm_receiver_data'];
                        if (msg['webm_receiver']) {
                            const MuxReceiver = (await import(msg['webm_receiver']))['MuxReceiver'];
                            self.webm_receiver = new MuxReceiver();
                            delete msg['webm_receiver'];
                            self.webm_receiver['addEventListener']('message', function (e) {
                                const msg2 = e.detail;
                                switch (msg2['type']) {
                                    case 'ready':
                                        this.start(msg);
                                        break;

                                    case 'exit':
                                        self.stream_exit(msg2['code']);
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
                        self.end_msg = msg;
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
        if (self.webm_receiver) {
            self.webm_receiver['muxed_data'](data, self.webm_receiver_data);
        } else {
            self.postMessage(Object.assign({
                type: 'muxed-data',
                data
            }, self.webm_receiver_data), [data]);
        }
        return size;
    },
    emscripten_exit: function (code) {
        if (self.webm_receiver) {
            self.webm_receiver['end'](self.end_msg, code);
        } else {
            self.stream_exit(code);
        }
        return code;
    }
});
