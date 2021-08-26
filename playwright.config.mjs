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
    webServer: {
        command: 'npx serve',
        port: 5000,
        reuseExistingServer: false
    }
};

export default config;
