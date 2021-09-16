// Adapted from https://github.com/muaz-khan/RecordRTC/blob/master/RecordRTC.js#L1906
// Requires https://github.com/muaz-khan/RecordRTC/blob/master/libs/EBML.js
// EBML.js copyright goes to: https://github.com/legokichi/ts-ebml

export class WebMWriter extends EventTarget {
    async start(suggestedName) {
        this.handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: 'WebM files',
                accept: {
                    'video/webm': '.webm'
                }
            }]
        });

        this.name = this.handle.name;
        this.writable = await this.handle.createWritable();
        this.size = 0;

        this.reader = new EBML.Reader();
        this.decoder = new EBML.Decoder();
    }

    async write(data) {
        this.decoder.readChunk(data);
        for (let elm of this.decoder._result) {
            this.reader.read(elm);
        }
        this.decoder._result = [];
        await this.writable.write(data);
        this.size += data.byteLength;
    }

    async finish() {
        await this.writable.close();

        this.reader.stop();
        this.duration = this.reader.duration;
        const refinedMetadataBuf = EBML.tools.makeMetadataSeekable(
                this.reader.metadatas, this.reader.duration, this.reader.cues);

        const reader = (await this.handle.getFile()).stream().getReader();

        try {
            this.writable = await this.handle.createWritable();
            await this.writable.write(refinedMetadataBuf);

            let to_skip = reader.metadataSize;
            let written = refinedMetadataBuf.byteLength;
            const total = this.size - reader.metadataSize + refinedMetadataBuf.byteLength;

            while (true) {
                this.dispatchEvent(new CustomEvent('progress', {
                    detail: {
                        written,
                        total
                    }
                }));

                let { value, done } = await reader.read();
                if (done) {
                    break;
                }
                if (to_skip > 0) {
                    const skip = Math.min(to_skip, value.length);
                    value = value.subarray(skip);
                    to_skip -= skip;
                }
                await this.writable.write(value);
                written += value.byteLength;
            }

            await this.writable.close();
            this.size = written;
        } finally {
            await reader.cancel();
        }
    }

    async cancel() {
        if (this.writable) {
            await this.writable.abort();
        }
    }
}
