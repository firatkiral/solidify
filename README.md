# Solidify

Solidify is a CAD app for modeling solids from sketches: draw curves, then extrude, revolve, sweep, fillet and combine them into bodies. It runs in the browser, and exports 3MF, STL, OBJ and STEP for 3D printing and other CAD apps. One unit is a millimeter.

For more information, visit [solidify.build](https://solidify.build/). The source lives at [github.com/firatkiral/solidify](https://github.com/firatkiral/solidify).

To learn the basics, follow the [threaded screw tutorial](public/tutorials/screw/screw-tutorial.pdf), which builds a hex screw step by step.

## Browsers

Solidify works in recent versions of Chrome, Edge, Firefox and Safari on desktop.

- **Chrome and Edge** save back to the file you opened, and File › Open Recent reopens files from disk.
- **Firefox and Safari** download a copy when you save, and Open Recent reopens a document from its autosave.

## Installing

Solidify can be installed as an app, with a window of its own: in Chrome or Edge, use the install button in the address bar, or Install on the start screen; in Safari on macOS, use File › Add to Dock. Installed from Chrome or Edge, it opens `.solidify` files from the desktop, and imports STEP, STL, 3MF and OBJ files, each in a window of its own; the menu and the document's name sit in the title bar.

Once it has loaded, Solidify works offline, in a tab as well as installed.

## Privacy

Documents, autosaves and settings stay in your browser and on your disk; nothing you make is uploaded. Autosaves are kept in the browser's storage, which the browser can clear to make space, so save your work to keep it. Settings › File exports your settings, keymap and theme to a file.

## Development

```bash
yarn install
yarn dev        # the app at http://localhost:5173
yarn test       # the tests
yarn typecheck
```

The app's icons are made from the logo, `icons/logo.svg`: `icon.svg` and `icon-maskable.svg` set it on the icons' background, and `icons/render.sh` renders them into `public/`.

## Building and deploying

```bash
yarn build      # into dist/
yarn preview    # dist/, served with the headers it's deployed with
```

`dist/` is a static site; deploy it to any static host. It includes a `_headers` file, which Cloudflare Pages and Netlify read, with the Content Security Policy, the other security headers, and the caching: files in `assets/` have hashed names and are kept for good, while `index.html`, `sw.js` and `manifest.webmanifest` are checked every time. On another host, set the same headers. The host should serve `.wasm` files as `application/wasm` and compress them (the geometry kernel is 23 MB, about 5 MB with Brotli).

A service worker keeps the app in the browser, so it starts offline. A deploy is downloaded in the background, only the files that changed; the app then offers to reload into the new version, and the document comes back from its autosave.

## License

Solidify is derived from Plasticity by Nick Kallen and is licensed under the GNU LGPL, version 3 (see [LICENSE](LICENSE)).
