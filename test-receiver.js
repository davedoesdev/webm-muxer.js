export class MuxReceiver extends EventTarget {
    constructor() {
        super();
        setTimeout(() => {
            this.dispatchEvent(new CustomEvent('message', { detail: {
                type: 'ready'
            }}));
        }, 0);
    }

    start(msg) {
        console.log('START', msg);
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'start-stream'
        }}));
    }

    muxed_data(data, receiver_data) {
        console.log('MUXED_DATA', data, receiver_data);
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'muxed-data',
            data,
            transfer: [data]
        }}));
    }

    end(msg, code) {
        console.log('END', msg, code);
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'exit',
            code
        }}));
    }
}
