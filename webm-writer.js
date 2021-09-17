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
        this.reader.stop();
        this.duration = this.reader.duration;
        const [refinedMetadataBuf, cues] = EBML.tools.makeMetadataSeekable(
                this.reader.metadatas, this.reader.duration, this.reader.cues, this.size);

        await this.writable.write(cues);
        this.size += cues.byteLength;

        await this.writable.seek(0);
        await this.writable.write(refinedMetadataBuf);

        const void_size = this.options.metadata_reserve_size + this.reader.metadataSize - refinedMetadataBuf.byteLength;

        await this.writable.write(new EBML.Encoder().encode([{
            name: 'Void',
            type: 'b',
            data: EBML.tools.Buffer.alloc(
                void_size
                // Subtract 1 for Void ID (0xEC)
                //   VINT_MARKER (first bit set) is at position 0 so length 1 byte
                - 1
                // If void_size is < 128 then it can be held in a single byte VINT
                // Otherwise it can be held in two bytes with VINT_MARKER as the first bit.
                // The remaining 15 bits can represent up to 32767, which is more than
                // enough because our reserved size is 1024.
                - (void_size < 128 ? 1 : 2))
        }]));

        await this.writable.close();

//TODO
//throw error in finish if there's not enough space
//we could also put the cues in there if there's enough space
//i.e. we could try first and if the size is too big then put them at the end


        // we should also detect if the refinedMetadataBuf is longer than we have space for
        // (including if we don't have enough space for a Void element)
        // and use the existing technique if so


    }

    async cancel() {
        if (this.writable) {
            await this.writable.abort();
        }
    }
}
