#include <iostream>
#include <webm_live_muxer.h>

static unsigned char buf[16 * 1024 * 1024];
static unsigned char codec_id[256];

const int video_flag = 0b01;
const int audio_flag = 0b10;

const int video_type_flag  = 0b001;
const int key_flag         = 0b010;
const int new_cluster_flag = 0b100;

extern "C" {
    int emscripten_read_async(unsigned char* buf, int size);
    int emscripten_write(unsigned char* buf, int size);
    int emscripten_exit(int code);
}

static int main2(int argc, const char** argv) {
    // read maximum cluster duration
    uint64_t max_cluster_duration;
    if (emscripten_read_async(reinterpret_cast<unsigned char*>(&max_cluster_duration), sizeof(max_cluster_duration)) != sizeof(max_cluster_duration)) {
        std::cerr << "Failed to read maximum cluster duration" << std::endl;
        return 1;
    }

    webm_tools::WebMLiveMuxer muxer;
    muxer.Init(max_cluster_duration, false);

    // read flags
    uint8_t flags;
    if (emscripten_read_async(reinterpret_cast<unsigned char*>(&flags), sizeof(flags)) != sizeof(flags)) {
        std::cerr << "Failed to read flags" << std::endl;
        return 1;
    }

    if (!(flags & video_flag) && !(flags & audio_flag)) {
        std::cerr << "No tracks to add" << std::endl;
        return 1;
    }

    if (flags & video_flag) {
        // read video width
        int32_t width;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&width), sizeof(width)) != sizeof(width)) {
            std::cerr << "Failed to read video width" << std::endl;
            return 1;
        }

        // read video height
        int32_t height;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&height), sizeof(height)) != sizeof(height)) {
            std::cerr << "Failed to read video height" << std::endl;
            return 1;
        }

        // read video frame rate
        static_assert(sizeof(float) == 4);
        float frame_rate;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&frame_rate), sizeof(frame_rate)) != sizeof(frame_rate)) {
            std::cerr << "Failed to read video frame rate" << std::endl;
            return 1;
        }

        // read video codec ID
        auto len = emscripten_read_async(codec_id, sizeof(codec_id) - 1);
        if ((len <= 0) || (len > (sizeof(codec_id) - 1))) {
            std::cerr << "Failed to read video codec ID" << std::endl;
            return 1;
        }
        codec_id[len] = '\0';

        // read private video codec data
        len = emscripten_read_async(buf, sizeof(buf));
        if ((len < 0) || (len > sizeof(buf))) {
            std::cerr << "Failed to read private video codec data" << std::endl;
            return 1;
        }

        // read pre-roll
        uint64_t pre_roll;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&pre_roll), sizeof(pre_roll)) != sizeof(pre_roll)) {
            std::cerr << "Failed to read pre-roll" << std::endl;
            return 1;
        }
        pre_roll *= 1000;
       
        // add video track
        auto r = muxer.AddVideoTrack(width, height, reinterpret_cast<char*>(codec_id), len > 0 ? buf : nullptr, len, frame_rate, pre_roll);
        if (r < 0) {
            std::cerr << "Failed to add video track: " << r << std::endl;
            return 1;
        }
    }

    if (flags & audio_flag) {
        // read audio sample rate
        int32_t sample_rate;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&sample_rate), sizeof(sample_rate)) != sizeof(sample_rate)) {
            std::cerr << "Failed to read audio sample rate" << std::endl;
            return 1;
        }

        // read number of audio channels
        int32_t channels;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&channels), sizeof(channels)) != sizeof(channels)) {
            std::cerr << "Failed to read number of audio channels" << std::endl;
            return 1;
        }

        // read audio bit depth
        int32_t bit_depth;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&bit_depth), sizeof(bit_depth)) != sizeof(bit_depth)) {
            std::cerr << "Failed to read audio bit depth" << std::endl;
            return 1;
        }

        // read audio codec ID
        auto len = emscripten_read_async(codec_id, sizeof(codec_id) - 1);
        if ((len <= 0) || (len > (sizeof(codec_id) - 1))) {
            std::cerr << "Failed to read video codec ID" << std::endl;
            return 1;
        }
        codec_id[len] = '\0';

        // read private audio codec data
        len = emscripten_read_async(buf, sizeof(buf));
        if ((len < 0) || (len > sizeof(buf))) {
            std::cerr << "Failed to read private audoi codec data" << std::endl;
            return 1;
        }

        // read pre-roll
        uint64_t pre_roll;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&pre_roll), sizeof(pre_roll)) != sizeof(pre_roll)) {
            std::cerr << "Failed to read pre-roll" << std::endl;
            return 1;
        }
        pre_roll *= 1000;
 
        // add audio track
        auto r = muxer.AddAudioTrack(sample_rate, channels, reinterpret_cast<char*>(codec_id), len > 0 ? buf : nullptr, len, bit_depth, pre_roll);
        if (r < 0) {
            std::cerr << "Failed to add audio track: " << r << std::endl;
            return 1;
        }
    }

    while (true) {
        // read frame header
        uint8_t header;
        auto len = emscripten_read_async(reinterpret_cast<unsigned char*>(&header), sizeof(header));
        if (len == 0) {
            std::cout << "End of input" << std::endl;
            muxer.Finalize();
        } else if (len != sizeof(header)) {
            std::cerr << "Failed to read frame header" << std::endl;
            return 1;
        }

        // write any muxed data that's ready
        int32_t chunk_length;
        while (muxer.ChunkReady(&chunk_length)) {
            if (chunk_length > sizeof(buf)) {
                std::cerr << "Buffer too small (" << chunk_length << " vs " << sizeof(buf) << ")" << std::endl;
                // TODO: Maybe dynamically allocate
                return 1;
            }
            auto r = muxer.ReadChunk(sizeof(buf), buf);
            if (r != webm_tools::WebMLiveMuxer::kSuccess) {
                std::cerr << "Failed to get muxed chunk" << std::endl;
                return 1;
            }
            if (emscripten_write(buf, chunk_length) != chunk_length) {
                std::cerr << "Failed to write muxed chunk" << std::endl;
                return 1;
            }
        }

        // no more frame data
        if (len == 0) {
            break;
        }

        // read timestamp
        uint64_t timestamp;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&timestamp), sizeof(timestamp)) != sizeof(timestamp)) {
            std::cerr << "Failed to read timestamp" << std::endl;
            return 1;
        }
        timestamp *= 1000;

        // read duration
        uint64_t duration;
        if (emscripten_read_async(reinterpret_cast<unsigned char*>(&duration), sizeof(duration)) != sizeof(duration)) {
            std::cerr << "Failed to read duration" << std::endl;
            return 1;
        }
        duration *= 1000;

        // read frame data
        len = emscripten_read_async(buf, sizeof(buf));
        if ((len < 0) || (len > sizeof(buf))) {
            std::cerr << "Failed to read frame data" << std::endl;
            return 1;
        }
        if (len == 0) {
            std::cout << "Zero-length data" << std::endl;
            return 1;
        }

        // mux frame data
        int r;
        const auto is_key = header & key_flag;
        const auto new_cluster = header & new_cluster_flag;
        if (header & video_type_flag) {
            r = muxer.WriteVideoFrame(buf, len, timestamp, duration, is_key, new_cluster);
        } else {
            r = muxer.WriteAudioFrame(buf, len, timestamp, duration, is_key, new_cluster);
        }
        if (r != webm_tools::WebMLiveMuxer::kSuccess) {
            std::cerr << "Failed to mux frame: " << r << std::endl;
            return 1;
        }
    }

    return 0;
}

int main(int argc, const char** argv) {
    return emscripten_exit(main2(argc, argv));
}
