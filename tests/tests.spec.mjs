import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { test, expect } from '@playwright/test';

const execFileP = promisify(execFile);

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

test.only('records to a vaild WebM file', async ({ page }) => {
    await page.goto('demo.html');
    expect(await page.title()).toBe('WebM muxer demo');
    await page.check('#record');
    await page.click('#start');
    await page.waitForFunction(() => !document.getElementById('video').paused);
    await page.waitForFunction(() => document.getElementById('video').currentTime > 10);
    const width = await page.evaluate(() => document.getElementById('video').videoWidth);
    const height = await page.evaluate(() => document.getElementById('video').videoHeight);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    const [ download ] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#stop')
    ]);
    const path = await download.path();
    let { stdout, stderr } = await execFileP('mediainfo', [ '--Output=JSON', path ]);
    expect(stderr).toBe('');
    console.log(stdout);
    const tracks = {};
    for (let track of JSON.parse(stdout).media.track) {
        tracks[track['@type']] = track;
    }
    expect(tracks.General.VideoCount).toBe('1');
    expect(tracks.General.AudioCount).toBe('1');
    expect(tracks.General.Format).toBe('WebM');
    expect(tracks.General.Format_Version).toBe('4');
    expect(parseFloat(tracks.General.Duration)).toBeGreaterThanOrEqual(10);
    expect(tracks.General.IsStreamable).toBe('Yes');
    expect(tracks.General.Encoded_Application).toBe('WebMLiveMuxer');
    expect(tracks.General.Encoded_Library).toBe('libwebm-0.3.0.0');

    expect(tracks.Video.Format).toBe('VP9');
    expect(tracks.Video.CodecID).toBe('V_VP9');
    expect(parseFloat(tracks.Video.Duration)).toBeGreaterThanOrEqual(10);
    expect(parseInt(tracks.Video.Width)).toBe(width);
    expect(parseInt(tracks.Video.Height)).toBe(height);

    expect(tracks.Audio.Format).toBe('Opus');
    expect(tracks.Audio.CodecID).toBe('A_OPUS');
    expect(tracks.Audio.Channels).toBe('1');
    expect(tracks.Audio.ChannelPositions).toBe('Front: C');
    expect(tracks.Audio.ChannelLayout).toBe('C');
    expect(tracks.Audio.SamplingRate).toBe('48000');
    expect(tracks.Audio.Compression_Mode).toBe('Lossy');
    expect(tracks.Audio.Delay).toBe('0.000');

    ({ stdout } = await execFileP('mkvmerge', [ '-J', path ]));
    console.log(stdout);
    const info = JSON.parse(stdout);

    expect(info.identification_format_version).toBe(14);
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

    expect(info.tracks[0].codec).toBe('VP9');
    expect(info.tracks[0].id).toBe(0);
    expect(info.tracks[0].type).toBe('video');
    expect(info.tracks[0].properties.codec_id).toBe('V_VP9');
    expect(info.tracks[0].properties.codec_private_data).toBe('01010002010a030108040101');
    expect(info.tracks[0].properties.codec_private_length).toBe(12);
    expect(info.tracks[0].properties.default_duration).toBe(Math.floor(1000000000 / 30)); // (1s / frame rate)
    expect(info.tracks[0].properties.default_track).toBe(true);
    expect(info.tracks[0].properties.display_dimensions).toBe(`${width}x${height}`);
    expect(info.tracks[0].properties.display_unit).toBe(0); // pixels
    expect(info.tracks[0].properties.enabled_track).toBe(true);
    expect(info.tracks[0].properties.forced_track).toBe(false);
    expect(info.tracks[0].properties.language).toBe('eng');
    expect(info.tracks[0].properties.minimum_timestamp).toBe(0);
    expect(info.tracks[0].properties.number).toBe(1);
    expect(info.tracks[0].properties.pixel_dimensions).toBe(`${width}x${height}`);

    expect(info.tracks[1].codec).toBe('Opus');
    expect(info.tracks[1].id).toBe(1);
    expect(info.tracks[1].type).toBe('audio');
    expect(info.tracks[1].properties.audio_channels).toBe(1);
    expect(info.tracks[1].properties.audio_sampling_frequency).toBe(48000);
    expect(info.tracks[1].properties.codec_id).toBe('A_OPUS');
    expect(info.tracks[1].properties.codec_private_data).toBe('4f707573486561640101000080bb0000000000');
    expect(info.tracks[1].properties.codec_private_length).toBe(19);
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
    expect((await readFile(`${path}.cues`)).length).toBeGreaterThan(0);


// sometimes Duration of a track isn't listed by mediainfo
// then check PCM works



    
});



