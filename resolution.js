// From https://github.com/webrtcHacks/WebRTC-Camera-Resolution/blob/master/js/resolutionScan.js
const resolutions = [{
        label: '4K (UHD)',
        width: 3840,
        height: 2160,
        ratio: 16/9
    }, {
        label: '1080p (FHD)',
        width: 1920,
        height: 1080,
        ratio: 16/9
    }, {
        label: 'UXGA',
        width: 1600,
        height: 1200,
        ratio: 4/3
    }, {
        label: '720p (HD)',
        width: 1280,
        height: 720,
        ratio: 16/9
    }, {
        label: 'SVGA',
        width: 800,
        height: 600,
        ratio: 4/3
    }, {
        label: 'VGA',
        width: 640,
        height: 480,
        ratio: 4/3
    }, {
        label: '360p (nHD)',
        width: 640,
        height: 360,
        ratio: 16/9
    }, {
        label: 'CIF',
        width: 352,
        height: 288,
        ratio: 4/3
    }, {
        label: 'QVGA',
        width: 320,
        height: 240,
        ratio: 4/3
    }, {
        label: 'QCIF',
        width: 176,
        height: 144,
        ratio: 4/3
    }, {
        label: 'QQVGA',
        width: 160,
        height: 120,
        ratio: 4/3
    }
];

const len = resolutions.length;
for (let i = 0; i < len; ++i) {
    const res = resolutions[i];
    resolutions.push({
        label: `${res.label} (portrait)`,
        width: res.height,
        height: res.width,
        ratio: 1/res.ratio
    });
}

export async function supported_video_configs(constraints, all_if_no_webcodecs) {
    if (!('VideoEncoder' in window)) {
        return all_if_no_webcodecs ? resolutions : [];
    }
    const r = [];
    for (let res of resolutions) {
        const support = await VideoEncoder.isConfigSupported({ ...constraints, ...res });
        if (support.supported) {
            r.push({
                ...res,
                ...support.config
            });
        }
    }
    return r;
}

export async function max_video_config(constraints, all_if_no_webcodecs) {
    constraints = constraints || {};
    for (let res of resolutions) {
        if ((!constraints.ratio || (res.ratio === constraints.ratio)) &&
            (!constraints.width || (res.width <= constraints.width)) &&
            (!constraints.height || (res.height <= constraints.height))) {
            if ('VideoEncoder' in window) {
                const support = await VideoEncoder.isConfigSupported({ ...constraints, ...res });
                if (support.supported) {
                    return {
                        ...res,
                        ...support.config
                    };
                }
            } else if (all_if_no_webcodecs) {
                return res;
            }
        }
    }
    return null;
}
