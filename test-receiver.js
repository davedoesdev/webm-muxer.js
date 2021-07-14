export class MuxReceiver extends EventTarget {
    constructor() {
        super();
        setTimeout(() => {
            this.dispatchEvent(new CustomEvent('message', { detail: {
                type: 'ready'
            }}));
        }, 0);
    }

    start() {
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'start-stream'
        }}));
    }

    muxed_data(data) {
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'muxed-data',
            data,
            transfer: [data]
        }}));
    }

    end() {
        this.dispatchEvent(new CustomEvent('message', { detail: {
            type: 'exit',
            code: 0
        }}));
    }
}
