import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { EOL } from 'os';
import { test, expect } from '@playwright/test';

test.slow();

const execFileP = promisify(execFile);
const setTimeoutP = promisify(setTimeout);

let log_on_fail;

test.beforeEach(async ({ page }) => {
    log_on_fail = '';
    page.on('console', msg => {
        //console.log(msg.text());
        log_on_fail += msg.text() + EOL;
    });
    page.on('pageerror', err => {
        log_on_fail += err.message + EOL;
    });
});

test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        console.error(log_on_fail);
    }
});

test('muxes camera and microphone into WebM format that can be played in browser', async ({ page }) => {
    await page.goto('demo.html');
    expect(await page.title()).toBe('WebM muxer demo');
    await page.click('#start');
    await page.waitForFunction(() => !document.getElementById('video').paused);
    await page.waitForFunction(() => document.getElementById('video').currentTime > 10);
    expect(await page.evaluate(() => document.getElementById('video').videoTracks.length)).toBe(1);
    expect(await page.evaluate(() => document.getElementById('video').audioTracks.length)).toBe(1);
    await page.click('#stop');
    await page.waitForFunction(() => document.getElementById('video').paused);
});

// We need to monkey patch window.showSaveFilePicker because of:
// https://github.com/microsoft/playwright/issues/8850
function polyfillShowSaveFilePicker() {
    window.showSaveFilePicker = async ({ suggestedName }) => {
        return {
            name: suggestedName,
            createWritable() {
                const data = [];
                let curpos = 0;
                return {
                    async write(buf) {
                        for (let b of new Uint8Array(buf)) {
                            data[curpos++] = b;
                        }
                    },

                    async seek(pos) {
                        curpos = pos;
                    },

                    async close() {
                        const a = document.createElement('a');
                        a.textContent = suggestedName;
                        a.href = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
                        a.download = suggestedName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }
                };
            }
        }
    };
}

for (let codec of ['vp09', 'av01']) {
    for (let pcm of [false, true]) {
        for (let chroma of [false, true]) {
            test(`records to a valid WebM file (codec=${codec},pcm=${pcm},chroma=${chroma})`, async ({ page }) => {
                await page.goto('demo.html');
                expect(await page.title()).toBe('WebM muxer demo');
                await page.check('#record');
                if (pcm) {
                    await page.click('#pcm');
                }
                await page.selectOption('#codec', codec);
                if (chroma) {
                    await page.locator('#chroma').evaluate(node => node.value = 'y');
                }
                await page.evaluate(polyfillShowSaveFilePicker);
                await page.click('#start');
                let width, height;
                if (pcm) {
                    await setTimeoutP(12000);
                } else {
                    await page.waitForFunction(() => !document.getElementById('video').paused);
                    await page.waitForFunction(() => document.getElementById('video').currentTime > 10);
                    width = await page.evaluate(() => document.getElementById('video').videoWidth);
                    height = await page.evaluate(() => document.getElementById('video').videoHeight);
                    expect(width).toBeGreaterThan(0);
                    expect(height).toBeGreaterThan(0);
                }

                const [ download ] = await Promise.all([
                    page.waitForEvent('download'),
                    page.click('#stop')
                ]);
                const path = await download.path();
                let { stdout, stderr } = await execFileP('mediainfo', [ '--Output=JSON', path ]);
                log_on_fail += stdout;
                expect(stderr).toBe('');
                const tracks = {};
                for (let track of JSON.parse(stdout).media.track) {
                    tracks[track['@type']] = track;
                }
                expect(tracks.General.VideoCount).toBe('1');
                expect(tracks.General.AudioCount).toBe('1');
                expect(tracks.General.Format).toBe(pcm ? 'Matroska' : 'WebM');
                expect(tracks.General.Format_Version).toBe('4');
                expect(parseFloat(tracks.General.Duration)).toBeGreaterThanOrEqual(10);
                expect(tracks.General.IsStreamable).toBe('Yes');
                expect(tracks.General.Encoded_Application).toBe('WebMLiveMuxer');
                expect(tracks.General.Encoded_Library).toBe('libwebm-0.3.0.0');

                expect(tracks.Video.Format).toBe(codec === 'av01' ? 'AV1' : 'VP9');
                expect(tracks.Video.CodecID).toBe(codec === 'av01' ? 'V_AV1' : 'V_VP9');
                if (tracks.Video.FrameRate_Mode === 'VFR') {
                    // mediainfo does VFR detection using timecodes so occasionally we trigger that detection
                    // https://github.com/MediaArea/MediaInfoLib/commit/f935443d48731c6524a69e8c25a04fcde9b4547d
                    expect(parseFloat(tracks.Video.FrameRate_Original)).toBe(30);
                } else {
                    expect(tracks.Video.FrameRate_Mode).toBe('CFR');
                    expect(parseFloat(tracks.Video.Duration)).toBeGreaterThanOrEqual(10);
                }
                if (pcm) {
                    width = parseInt(tracks.Video.Width);
                    height = parseInt(tracks.Video.Height);
                } else {
                    expect(parseInt(tracks.Video.Width)).toBe(width);
                    expect(parseInt(tracks.Video.Height)).toBe(height);
                }

                expect(tracks.Audio.Format).toBe(pcm ? 'PCM' : 'Opus');
                expect(tracks.Audio.CodecID).toBe(pcm ? 'A_PCM/FLOAT/IEEE' : 'A_OPUS');
                expect(parseFloat(tracks.Audio.Duration)).toBeGreaterThanOrEqual(10);
                expect(tracks.Audio.Channels).toBe('2');
                if (!pcm) {
                    expect(tracks.Audio.ChannelPositions).toBe('Front: L R');
                    expect(tracks.Audio.ChannelLayout).toBe('L R');
                    expect(tracks.Audio.Compression_Mode).toBe('Lossy');
                }
                expect(tracks.Audio.SamplingRate).toBe('44100');
                expect(parseFloat(tracks.Audio.Delay)).toBe(0);

                ({ stdout, stderr } = await execFileP('mkvmerge', [ '-J', path ]));
                log_on_fail += stdout;
                expect(stderr).toBe('');
                const info = JSON.parse(stdout);

                expect(info.identification_format_version).toBeGreaterThanOrEqual(12);
                expect(info.attachments.length).toBe(0);
                expect(info.chapters.length).toBe(0);
                expect(info.container.properties.container_type).toBe(17); // https://gitlab.com/mbunkus/mkvtoolnix/-/blob/main/src/common/file_types.h file_type_e::matroska
                expect(info.container.properties.duration).toBeGreaterThanOrEqual(10000000000);
                expect(info.container.properties.is_providing_timestamps).toBe(true);
                expect(info.container.properties.muxing_application).toBe('libwebm-0.3.0.0');
                expect(info.container.properties.writing_application).toBe('WebMLiveMuxer');
                expect(info.container.recognized).toBe(true);
                expect(info.container.supported).toBe(true);
                expect(info.container.type).toBe('Matroska');
                expect(info.errors.length).toBe(0);
                expect(info.warnings.length).toBe(0);
                expect(info.file_name).toBe(path);
                expect(info.global_tags.length).toBe(0);
                expect(info.track_tags.length).toBe(0);
                expect(info.tracks.length).toBe(2);

                expect(info.tracks[0].codec).toBe(codec === 'av01' ? 'AV1' : 'VP9');
                expect(info.tracks[0].id).toBe(0);
                expect(info.tracks[0].type).toBe('video');
                expect(info.tracks[0].properties.codec_id).toBe(codec === 'av01' ? 'V_AV1' : 'V_VP9');
                expect(info.tracks[0].properties.codec_private_data).toBe(
                    codec === 'av01' ? ('81000' + (chroma ? 'c' : '0') + '00') :
                                       ('01010002010a03010804010' + (chroma ? '2' : '1')));
                expect(info.tracks[0].properties.codec_private_length).toBe(codec === 'av01' ? 4 : 12);
                if (info.identification_format_version >= 14) {
                    expect(info.tracks[0].properties.default_duration).toBe(Math.floor(1000000000 / 30)); // (1s / frame rate)
                }
                expect(info.tracks[0].properties.default_track).toBe(true);
                expect(info.tracks[0].properties.display_dimensions).toBe(`${width}x${height}`);
                expect(info.tracks[0].properties.display_unit).toBe(0); // pixels
                expect(info.tracks[0].properties.enabled_track).toBe(true);
                expect(info.tracks[0].properties.forced_track).toBe(false);
                expect(info.tracks[0].properties.language).toBe('eng');
                expect(info.tracks[0].properties.minimum_timestamp).toBe(0);
                expect(info.tracks[0].properties.number).toBe(1);
                expect(info.tracks[0].properties.pixel_dimensions).toBe(`${width}x${height}`);

                expect(info.tracks[1].codec).toBe(pcm ? 'PCM' : 'Opus');
                expect(info.tracks[1].id).toBe(1);
                expect(info.tracks[1].type).toBe('audio');
                expect(info.tracks[1].properties.audio_channels).toBe(2);
                expect(info.tracks[1].properties.audio_sampling_frequency).toBe(44100);
                expect(info.tracks[1].properties.codec_id).toBe(pcm ? 'A_PCM/FLOAT/IEEE' : 'A_OPUS');
                if (!pcm) {
                    expect(info.tracks[1].properties.codec_private_data).toBe('4f707573486561640102000044ac0000000000');
                }
                expect(info.tracks[1].properties.codec_private_length).toBe(pcm ? 0 : 19);
                expect(info.tracks[1].properties.default_track).toBe(true);
                expect(info.tracks[1].properties.enabled_track).toBe(true);
                expect(info.tracks[1].properties.forced_track).toBe(false);
                expect(info.tracks[1].properties.language).toBe('eng');
                expect(info.tracks[1].properties.minimum_timestamp).toBe(0);
                expect(info.tracks[1].properties.number).toBe(2);

                ({ stdout, stderr } = await execFileP('ffmpeg', [
                    '-v', 'error',
                    '-i', path,
                    '-f', 'null',
                    '-'
                ]));
                expect(stdout).toBe('');
                expect(stderr).toBe('');

                // Check there are keyframes in the video
                ({ stdout, stderr } = await execFileP('ffmpeg', [
                    '-ss', '5',
                    '-noaccurate_seek', // nearest keyframe
                    '-v', 'error',
                    '-i', path,
                    '-f', 'null',
                    '-'
                ]));
                expect(stdout).toBe('');
                expect(stderr).toBe('');

                // Check there are cues in the metadata (i.e. it's seekable).
                // Exits with status 2 if no cues were found (so throws an exception).
                ({ stdout, stderr } = await execFileP('mkvextract', [
                    path,
                    'cues', `0:${path}.cues`
                ]));
                expect(stdout).toBe(`The cues for track 0 are written to '${path}.cues'.\n`);
                expect(stderr).toBe('');
                const cues = (await readFile(`${path}.cues`)).toString();
                expect(cues.trim().split('\n').length).toBeGreaterThanOrEqual(10);
            });
        }
    }
}
