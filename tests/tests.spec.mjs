
// then check we can record and get webm saved out
// use the tools from the issues to check it's as expected

// then check PCM works

// can we use ffmpeg to play it through fast?
// or some other tool to validate it?
// also check it's seekable

import { execFile } from 'child_process';
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
    let { stdout } = await execFileP('mediainfo', [ '--Output=JSON', path ]);
    const tracks = {};
    for (let track of JSON.parse(stdout).media.track) {
        tracks[track['@type']] = track;
    }
    expect(tracks.General.VideoCount).toBe('1');
    expect(tracks.General.AudioCount).toBe('1');
    expect(tracks.General.Format).toBe('WebM');
    expect(tracks.General.Format_Version).toBe('4');
    expect(parseInt(tracks.General.Duration)).toBeGreaterThanOrEqual(10);
    expect(tracks.General.IsStreamable).toBe('Yes');
    expect(tracks.General.Encoded_Application).toBe('WebMLiveMuxer');
    expect(tracks.General.Encoded_Library).toBe('libwebm-0.3.0.0');

    expect(tracks.Video.Format).toBe('VP9');
    expect(tracks.Video.CodecID).toBe('V_VP9');
    expect(parseInt(tracks.Video.Duration)).toBeGreaterThanOrEqual(10);
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

/*
{
  "attachments": [],
  "chapters": [],
  "container": {
    "properties": {
      "container_type": 17,
      "duration": 13440000000,
      "is_providing_timestamps": true,
      "muxing_application": "libwebm-0.3.0.0",
      "writing_application": "WebMLiveMuxer"
    },
    "recognized": true,
    "supported": true,
    "type": "Matroska"
  },
  "errors": [],
  "file_name": "/tmp/playwright-artifacts-wKWDbD/be3d52c2-ee4f-4e6b-ab03-ed2943d78a74",
  "global_tags": [],
  "identification_format_version": 14,
  "track_tags": [],
  "tracks": [
    {
      "codec": "VP9",
      "id": 0,
      "properties": {
        "codec_id": "V_VP9",
        "codec_private_data": "01010002010a030108040101",
        "codec_private_length": 12,
        "default_duration": 33333333,
        "default_track": true,
        "display_dimensions": "3840x2160",
        "display_unit": 0,
        "enabled_track": true,
        "forced_track": false,
        "language": "eng",
        "minimum_timestamp": 0,
        "number": 1,
        "pixel_dimensions": "3840x2160",
        "uid": 53530440274049695
      },
      "type": "video"
    },
      "codec": "Opus",
      "id": 1,
      "properties": {
        "audio_channels": 1,
        "audio_sampling_frequency": 48000,
        "codec_id": "A_OPUS",
        "codec_private_data": "4f707573486561640101000080bb0000000000",
        "codec_private_length": 19,
        "default_track": true,
        "enabled_track": true,
        "forced_track": false,
        "language": "eng",
        "minimum_timestamp": 0,
        "number": 2,
        "uid": 11423568537332234
      },
      "type": "audio"
    }
  ],
  "warnings": []
}
*/



    
});


// check saved webm resolution matches one in page

