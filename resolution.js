// From https://github.com/webrtcHacks/WebRTC-Camera-Resolution/blob/master/js/resolutionScan.js
const resolutions = [{
        label: '4K (UHD)',
        width: 3840,
        height: 2160,
        ratio: '16:9'
    }, {
        label: '1080p (FHD)',
        width: 1920,
        height: 1080,
        ratio: '16:9'
    }, {
        label: 'UXGA',
        width: 1600,
        height: 1200,
        ratio: '4:3'
    }, {
        label: '720p (HD)',
        width: 1280,
        height: 720,
        ratio: '16:9'
    }, {
        label: 'SVGA',
        width: 800,
        height: 600,
        ratio: '4:3'
    }, {
        label: 'VGA',
        width: 640,
        height: 480,
        ratio: '4:3'
    }, {
        label: '360p (nHD)',
        width: 640,
        height: 360,
        ratio: '16:9'
    }, {
        label: 'CIF',
        width: 352,
        height: 288,
        ratio: '4:3'
    }, {
        label: 'QVGA',
        width: 320,
        height: 240,
        ratio: '4:3'
    }, {
        label: 'QCIF',
        width: 176,
        height: 144,
        ratio: '4:3'
    }, {
        label: 'QQVGA',
        width: 160,
        height: 120,
        ratio: '4:3'
    }
];

export async function supported_video_encoder_configs(constraints) {
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

export async function max_video_encoder_config(constraints) {
    constraints = constraints || {};
    for (let res of resolutions) {
        if ((!constraints.ratio || (res.ratio === constraints.ratio)) &&
            (!constraints.width || (res.width <= constraints.width)) &&
            (!constraints.height || (res.height <= constraints.height))) {
            const support = await VideoEncoder.isConfigSupported({ ...constraints, ...res });
            if (support.supported) {
                return {
                    ...res,
                    ...support.config
                };
            }
        }
    }
    return null;
}

async function gum(constraints, res) {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            ...constraints,
            ...res
        }
    });
    for (let track of stream.getTracks()) {
        track.stop();
    }
    return {
        ...constraints,
        ...res
    };
}

export async function min_camera_video_config(constraints) {
    constraints = constraints || {};
    for (let i = resolutions.length - 1; i >= 0; --i) {
        const res = resolutions[i];
        if ((!constraints.ratio || (res.ratio === constraints.ratio)) &&
            (!constraints.width || (res.width >= constraints.width)) &&
            (!constraints.height || (res.height >= constraints.height))) {
            try {
                return await gum(constraints, res);
            } catch (ex) {}
        }
    }
    return null;
}

export async function max_camera_video_config(constraints) {
    constraints = constraints || {};
    for (let res of resolutions) {
        if ((!constraints.ratio || (res.ratio === constraints.ratio)) &&
            (!constraints.width || (res.width <= constraints.width)) &&
            (!constraints.height || (res.height <= constraints.height))) {
            try {
                return await gum(constraints, res);
            } catch (ex) {}
        }
    }
    return null;
}
