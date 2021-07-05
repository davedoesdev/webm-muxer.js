onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'start':
            postMessage({ type: 'start-stream' });
            break;

        case 'muxed-data':
            msg.transfer = [msg.data];
            postMessage(msg, msg.transfer);
            break;

        case 'end':
            postMessage({ type: 'exit', code: 0 });
            break;
    }
};

postMessage({ type: 'ready' });
