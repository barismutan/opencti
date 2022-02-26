const express = require('express');
const {createProxyMiddleware} = require('http-proxy-middleware');
const {readFileSync} = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const chokidar = require("chokidar");
const compression = require("compression");
const {RelayPlugin} = require("../plugin/esbuild-relay");

const basePath = "";
const clients = [];

// Start with an initial build
esbuild.build({
    logLevel: 'info',
    plugins: [RelayPlugin],
    entryPoints: ['src/index.tsx'],
    bundle: true,
    banner: {
        js: ' (() => new EventSource("http://localhost:3000/dev").onmessage = () => location.reload())();',
    },
    loader: {
        '.js': 'jsx',
        '.svg': 'file',
        '.png': 'file',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
        '.ttf': 'dataurl'
    },
    assetNames: "media/[name]-[hash]",
    target: ['chrome58'],
    minify: false,
    keepNames: true,
    sourcemap: true,
    sourceRoot: 'src',
    outdir: 'builder/dev/build',
    incremental: true,
}).then((builder) => {
    // Listen change for hot recompile
    chokidar.watch("src/**/*.{js,jsx,ts,tsx}", {awaitWriteFinish: true, ignoreInitial: true})
        .on("all", (eventName, path) => {
            const start = new Date().getTime();
            console.log(`[HOT RELOAD] Update of ${path} ${eventName} detected`);
            return builder.rebuild().then(() => {
                const time = new Date().getTime() - start;
                console.log(`[HOT RELOAD] Rebuild done in ${time} ms, updating frontend`);
                clients.forEach((res) => res.write("data: update\n\n"));
                clients.length = 0;
            });
        });
    // Start a dev web server
    const app = express();
    app.set('trust proxy', 1);
    app.get('/dev', (req, res) => {
        return clients.push(
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
                Connection: "keep-alive",
            }),
        );
    });
    app.use(createProxyMiddleware('/stream', {target: 'http://localhost:4000', changeOrigin: true, ws: false}));
    app.use(createProxyMiddleware('/taxii2', {target: 'http://localhost:4000', changeOrigin: true, ws: false}));
    app.use(createProxyMiddleware('/graphql', {target: 'http://localhost:4000', changeOrigin: true, ws: true}));
    app.use(createProxyMiddleware('/auth/**', {target: 'http://localhost:4000', changeOrigin: true, ws: true}));
    app.use(compression({}));
    app.use(`/css`, express.static(path.join(__dirname, './build')));
    app.use(`/js`, express.static(path.join(__dirname, './build')));
    app.use(`/media`, express.static(path.join(__dirname, './build/media')));
    app.use(`/static`, express.static(path.join(__dirname, '../public/static')));
    app.get('*', (req, res) => {
        const data = readFileSync(`${__dirname}/index.html`, 'utf8');
        const withOptionValued = data.replace(/%BASE_PATH%/g, basePath);
        res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.header('Expires', '-1');
        res.header('Pragma', 'no-cache');
        return res.send(withOptionValued);
    });
    app.listen(3000);
});
