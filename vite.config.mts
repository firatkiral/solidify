import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const kernelSize = statSync(new URL('./node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)).size;
// Tells one deploy from the next
const build = Date.now().toString(36);
const background = '#111115';

// The kernel's bindings make functions with `new Function`, so scripts need 'unsafe-eval' as well as 'wasm-unsafe-eval'.
const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

const securityHeaders: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// For static hosts that read a _headers file, like Cloudflare Pages and Netlify. Hashed assets never change, so they're
// kept for good; the page, the service worker and the manifest are checked every time, so a deploy reaches everyone.
const headersFile = [
    '/*',
    ...Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`),
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ...['/', '/index.html', '/sw.js', '/manifest.webmanifest'].flatMap(path => [path, '  Cache-Control: no-cache']),
    '',
].join('\n');

function release(): Plugin {
    return {
        name: 'solidify-release',
        apply: 'build',
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile });
        },
    };
}

// Installs as an app with its own window, which opens .solidify files from the desktop and imports models. A service
// worker keeps every file in the browser, the kernel included, so the app starts offline; a deploy downloads only the
// files that changed, and the app switches to it when the user reloads (see src/startup/ServiceWorker.ts).
const pwa = VitePWA({
    // Registered by the app once it has started, so caching doesn't compete with the kernel's download
    injectRegister: false,
    registerType: 'prompt',
    // The glob below has them already
    includeManifestIcons: false,
    manifest: {
        name: 'Solidify',
        short_name: 'Solidify',
        description: 'Model solids from sketches, and export them for 3D printing as 3MF, STL or STEP.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        // The menu and the document's name go in the title bar
        display_override: ['window-controls-overlay'],
        background_color: background,
        theme_color: background,
        icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
            { action: './', accept: { 'application/x-solidify': ['.solidify'] } },
            {
                action: './',
                accept: {
                    'model/step': ['.step', '.stp'],
                    'model/stl': ['.stl'],
                    'model/3mf': ['.3mf'],
                    'model/obj': ['.obj'],
                },
            },
        ],
        // One document per window, so each file opens in a window of its own
        launch_handler: { client_mode: 'navigate-new' },
    },
    workbox: {
        globPatterns: ['**/*'],
        globIgnores: ['**/*.map', '_headers', 'sw.js', 'workbox-*.js', 'manifest.webmanifest'],
        // The kernel is 23 MB
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        inlineWorkboxRuntime: true,
        sourcemap: false,
        // The tutorials are pages of their own
        navigateFallbackDenylist: [/\/tutorials\//],
    },
});

export default defineConfig(({ mode, command }) => ({
    resolve: {
        alias: [
            // The app is written against the C3D kernel's API, implemented on OpenCascade in src/kernel/occt
            { find: /^.*\/build\/Release\/c3d\.node$/, replacement: fileURLToPath(new URL('./src/kernel/occt/index.ts', import.meta.url)) },
        ],
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.APP_VERSION': JSON.stringify(pkg.version),
        'process.env.BUILD_ID': JSON.stringify(command === 'build' ? build : 'dev'),
        'process.env.KERNEL_SIZE': JSON.stringify(String(kernelSize)),
        'process.env.JEST_WORKER_ID': 'undefined',
    },
    assetsInclude: ['**/*.exr'],
    optimizeDeps: {
        // Linked from packages/, so it isn't found in node_modules, but it is CommonJS and needs converting like one
        include: ['atom-keymap-solidify'],
        // It loads its .wasm from next to itself, which pre-bundling would move it away from
        exclude: ['replicad-opencascadejs'],
    },
    plugins: [release(), pwa],
    build: {
        target: 'es2022',
        sourcemap: true,
        rolldownOptions: {
            // Commands, dialogs and gizmos are named after their classes, so minifying mustn't rename them
            output: { keepNames: true },
        },
    },
    preview: {
        headers: securityHeaders,
    },
}));
