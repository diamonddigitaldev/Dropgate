'use strict';

// The desktop app's electron-builder config, made by the kit's config() on its
// base (NSIS in the Diamond Digital Development menu folder; AppImage, .deb and
// .rpm). It's .cjs, never .js: on Windows, electron-builder typed in this
// folder would run electron-builder.js with Windows Script Host instead.
//
// - Dropgate takes any file (allFiles): on Windows, the installer asks who
//   it's for and whether to add Share with Dropgate to the menu files have
//   when they're right-clicked, and claims no file type; on Linux, the app is
//   in Open With for any file. v3's association for "*" registered a literal
//   ".*" extension, so it never did anything.
// - files is an allowlist: the client's src/, and only the kit's, Bootstrap's
//   and Material Icons' files the pages load. CI lists app.asar against it.
const { config } = require('@diamonddigitaldev/electron-kit/builder');

module.exports = config(require('./package.json'), {
    build: {
        appId: 'com.diamonddigitaldev.dropgateclient',
        productName: 'Dropgate Client',
        artifactName: 'Dropgate-Client-${version}.${ext}',
        files: [
            'src/**/*',
            '!src/img/*.icns',
            '!node_modules/@diamonddigitaldev/electron-kit/{testing,builder}{,/**/*}',
            '!node_modules/@diamonddigitaldev/electron-kit/README.md',
            '!node_modules/bootstrap/{js,scss}{,/**/*}',
            '!node_modules/bootstrap/dist/js{,/**/*}',
            '!node_modules/bootstrap/dist/css/!(bootstrap.min.css)',
            '!node_modules/material-icons/{_data,css}{,/**/*}',
            '!node_modules/material-icons/iconfont/!(round.css|material-icons-round.woff|material-icons-round.woff2)',
            '!node_modules/material-icons/index.d.ts',
        ],
        publish: {
            provider: 'github',
            owner: 'diamonddigitaldev',
            repo: 'Dropgate',
        },
        win: {
            icon: 'src/img/dropgate.ico',
        },
        // The installer's name is what its update files point at: unchanged from v3.
        nsis: {
            artifactName: 'Dropgate-Client-Setup-${version}.${ext}',
        },
        linux: {
            icon: 'src/img/dropgate.png',
            category: 'Network',
        },
    },
    allFiles: true,
    // Share with Dropgate: the file, then --upload (main.js uploads it in the background).
    contextMenu: { label: 'Share with Dropgate', args: ['--upload'] },
});
