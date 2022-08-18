const config = {
    use: {
        launchOptions: {
            args: [
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                '--enable-experimental-web-platform-features'
            ]
        },
        contextOptions: {
            acceptDownloads: true
        }
    },
    reportSlowTests: {
        max: 0,
        threshold: 5 * 60000
    },
    webServer: {
        command: 'npx serve',
        port: 3000,
        reuseExistingServer: false
    },
    timeout: 5 * 60000
};

export default config;
