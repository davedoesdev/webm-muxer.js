// Adapted from https://github.com/muaz-khan/RecordRTC/blob/master/RecordRTC.js#L1906
// Requires https://github.com/muaz-khan/RecordRTC/blob/master/libs/EBML.js
// EBML.js copyright goes to: https://github.com/legokichi/ts-ebml

export class WebMWriter {
    constructor(options) {
        this.options = {
            // Metadata length without cues is about 281 bytes, we'll leave more
            metadata_reserve_size: 1024,
            ...options
        };
    }

    async start(suggestedName) {
        if (suggestedName) {
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
            await this.writable.write(new ArrayBuffer(this.options.metadata_reserve_size));
            this.size = this.options.metadata_reserve_size;
        } else {
            this.chunks = [];
            this.size = 0;
        }

        this.reader = new EBML.Reader();
        this.decoder = new EBML.Decoder();
    }

    async write(data) {
        this.decoder.readChunk(data);
        for (let elm of this.decoder._result) {
            this.reader.read(elm);
        }
        this.decoder._result = [];
        if (this.writable) {
            await this.writable.write(data);
        } else {
            this.chunks.push(data);
        }
        this.size += data.byteLength;
    }

    async finish() {
        this.reader.stop();
        this.duration = this.reader.duration;

        if (!this.writable) {
            let refinedMetadataBuf = EBML.tools.makeMetadataSeekable(
                this.reader.metadatas, this.reader.duration, this.reader.cues);

            let to_skip = this.reader.metadataSize;
            while (to_skip >= this.chunks[0].byteLength) {
                to_skip -= this.chunks[0].byteLength;
                this.chunks.shift();
            }
            if (to_skip > 0) {
                this.chunks[0] = Uint8Array.from(this.chunks[0]).subarray(to_skip);
            }
            this.size -= this.reader.metadataSize;

            this.chunks.unshift(refinedMetadataBuf);
            this.size += refinedMetadataBuf.byteLength;

            return this.chunks;
        }

        const space = this.options.metadata_reserve_size + this.reader.metadataSize;

        const has_space = () => {
            return refinedMetadataBuf.byteLength === space ||
                   refinedMetadataBuf.byteLength <= space - 2; // min Void size is 2
        };

        const write_metadata = async () => {
            await this.writable.seek(0);
            await this.writable.write(refinedMetadataBuf);

            let void_size = space - refinedMetadataBuf.byteLength;
            if (void_size >= 2) {
                await this.writable.write(new EBML.Encoder().getSchemaInfo('Void'));
                void_size -= 2; // one for element ID (above), one for VINT_WIDTH
                if (void_size < 4) {
                    await this.writable.write(Uint8Array.from([void_size & 0x80]));
                } else {
                    const buf = new ArrayBuffer(5);
                    const view = new DataView(buf);
                    view.setUint8(0, 0b00001000);
                    view.setUint32(1, void_size - 4);
                    await this.writable.write(buf);
                }
            }

            await this.writable.close();
        };

        let refinedMetadataBuf = EBML.tools.makeMetadataSeekable(
                this.reader.metadatas, this.reader.duration, this.reader.cues, this.options.metadata_reserve_size);
        if (has_space()) {
            await write_metadata();
            return true;
        }

        let cues;
        ([refinedMetadataBuf, cues] = EBML.tools.makeMetadataSeekable(
                this.reader.metadatas, this.reader.duration, this.reader.cues, this.options.metadata_reserve_size, this.size));
        if (has_space()) {
            await this.writable.write(cues);
            this.size += cues.byteLength;
            await write_metadata();
            return false;
        }

        throw new Error('no space for metadata');
    }

    async cancel() {
        if (this.writable) {
            await this.writable.abort();
        }
    }
}
