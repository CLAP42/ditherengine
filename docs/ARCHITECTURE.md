# Architecture

Dither Engine is an image / GIF / video dithering tool. The whole engine lives in
a single self-contained `dither-engine.html`. The macOS `Dither Engine.app` is a
minimal native wrapper that hosts that HTML in an `NSWindow` + `WKWebView`, with a
JS↔native bridge for file open/save panels.

## `dither-engine.html`

The HTML contains **two `<script>` blocks**:

1. **`<script id="dither-core">`** — the **pure engine**: `PALETTES`,
   `makeNearestFn`, `extractPalette`, gamma lookup tables, `ALGORITHMS` (+
   registry), `EFFECTS`, and **`processWithCfg(imd, cfg)`** (the pipeline, driven
   by a config object rather than global `state`). This block is **re-injected
   verbatim into the Web Worker** via its `textContent`, so every private helper
   travels with it. It must **never reference main-thread globals** (`state`,
   `document`, `window`) — keep it that way or the worker breaks.
2. **`<script>`** (the rest) — `state`, thin wrappers, rendering, UI, presets,
   file I/O, export, init.

| Section | Role |
|---|---|
| `PALETTES` | 25 palettes (grayscales, retro-hardware-style, vapor, faded/vintage, …) |
| `makeNearestFn` / `extractPalette` | Nearest-color quantization + median cut |
| Gamma helpers | sRGB↔linear lookup tables (`sRGBtoLin`, `LinToSRGB`) |
| `ALGORITHMS` (+ registry) | 20 algorithms: Floyd–Steinberg, Atkinson, Bayer, blue noise, halftone CMYK… |
| `EFFECTS` | 25 stackable effects with params |
| **`processWithCfg`** | **Pure pipeline (effects → dither), shared by main thread + worker** |
| `state` | Mutable global UI state (algo, palette, effects, …) |
| `buildCfg` / `processImageData` | Snapshot `state`→cfg; sync wrapper (unchanged for callers) |
| Worker pool | `workerPool()` / `pumpPool()` / `processViaWorker()` + `WORKER_MIN_PX`, sync fallback |
| Rendering | Render + debounce + downsampled preview (stays synchronous) |
| UI / `PRESETS` / user presets | Controls, 24 presets, localStorage + JSON import/export |
| File loading / GIF decode | Image / in-house GIF89a / video · LZW + interlacing + disposal |
| Export | PNG/JPG, GIF (in-house encoder), WebM — large buffers/frames go through the worker |
| Samples / init | Procedural test images · bootstrap + drag-drop + shortcuts |

### Performance

Heavy work (full-resolution image export, GIF/video frame batches) runs on a
**Web Worker pool** built from the `#dither-core` script text. Output is
byte-identical to the synchronous path, and the code falls back to synchronous
processing if Workers are unavailable. The preview stays synchronous (already
downsampled to ~1.2 MP).

## Inventory

**Algorithms (20)** — Threshold, Floyd–Steinberg (+ False), Atkinson, Burkes,
Stucki, Jarvis–Judice–Ninke, Sierra (3-row, 2-row, Lite), Stevenson–Arce, Bayer
2/4/8/16, clustered dot 8×8, blue noise (void-and-cluster), random, round
halftone, CMYK halftone.

**Effects (25)** — color (brightness, contrast, saturation, hue, invert,
posterize), texture (pixelate, blur, sharpen, vignette, noise), analog glitch
(chromatic aberration, scanlines, JPEG glitch, wave displace, tape tear, RGB
desync, CRT shadow mask, chroma smear, slit-scan), faded/vintage (color cast,
split tone, light leak, film grain, glow/bloom).

**Palettes (25)** — B&W, 4/8/16 grays, Handheld Green/Grey, CGA 0/1, EGA, Home
Computer 16, Fantasy Console 16, Candy 16, Vivid 32, 8-bit Console (54), Analog
Tape, Vaporwave, Phosphor green, Amber CRT, Faded Pastel, Dusk Synthetic, Hazy
Analog, Warm Nostalgia, Ember, Vintage Film, Custom (editable).

**Presets (24)** — Handheld Green/Grey, Classic 1-bit, Newspaper, CMYK Print,
Duplicator Pink, CRT, Fantasy Console, 8-bit Console, Home Computer, Glitch, Blue
noise B&W, Neon CRT (+ pink), Analog Glitch, Abstract Glitch, CRT phosphor, VHS
dub, Faded Instant, Dusk Synthetic, Warm Nostalgia, Hazy Analog, Ember, Vintage
Home Movie.

## macOS `.app` wrapper

Minimal, 100% standard macOS, no dependencies (osascript + WebKit ship with the OS).

- **`MacOS/DitherEngine`** (bash) — resolves bundle paths, checks the resources,
  then **`exec osascript -l JavaScript main.js HTML_PATH`** (logs to
  `~/Library/Logs/DitherEngine.log`). The `exec` is **required**: without it the
  bundle process stays `bash` and the open-document Apple Event (file dropped on
  the icon) never reaches our `NSApplication`.
- **`Resources/main.js`** (JXA) — creates `NSWindow` + `WKWebView`, injects a user
  script that (a) overrides `window.downloadBlob` →
  `webkit.messageHandlers.savefile.postMessage(...)`, and (b) defines
  `window.loadFileFromNative(b64,name,mime)` which rebuilds a `File` and calls
  `loadFile()`. `DEAppDelegate` handles `application:openFiles:` /
  `application:openFile:` (drop / Open With) and exposes `deOpenDocument:` /
  `deSaveDocument:` for the menus. `deLoadPathIntoWeb(path)` reads the file as
  NSData, base64-encodes it, and injects it via `evaluateJavaScript` (with an
  in-page retry for cold starts). Menu bar: App, File (Open ⌘O / Save PNG ⌘S /
  Close ⌘W), Edit, View, Window.
- **`Info.plist`** — `CFBundleIdentifier=local.ditherengine.app`,
  `LSMinimumSystemVersion=10.13`, `NSHighResolutionCapable=true`,
  `CFBundleIconFile=icon`, `CFBundleDocumentTypes` (public.image / public.movie /
  webm, role Viewer, rank Alternate).

> The app is **ad-hoc signed**. **Re-sign after any change to the bundle** —
> editing files invalidates the signature:
> ```bash
> codesign --force --deep --sign - "Dither Engine.app"
> ```

## Open items

- No preset thumbnail previews in the sidebar (UX).
- On some macOS versions the app shows as `osascript` in Cmd-Tab (a JXA quirk; a
  real Swift binary would fix it but needs Xcode CLT).
- Preset import/export still goes through the HTML buttons, not a native menu.
- DMG has no custom background image.
- Worker wall-clock speedup hasn't been measured in the real app on a true 4K
  image / video export; `WORKER_MIN_PX` may want tuning afterward.

## Testing

No formal automated tests. Manual validation:

- Load the portrait/photo sample → cycle presets → check coherent output.
- Load a short GIF → export GIF → check the loop.
- Load an MP4 → export WebM → check playback.

Quick CLI syntax/functional check of the engine core:

```bash
node -e "const html=require('fs').readFileSync('dither-engine.html','utf8'); \
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(m[1]); \
  console.log('scripts parse OK')"
```

## Version history

- **v1.0** — first cut: standalone HTML, 20 algorithms, 15 palettes, 12 presets.
- **v1.1** — `.app` bundle with a Python server (dropped — port issues).
- **v1.2** — readable Neon CRT preset rework.
- **v1.3** — switched to JXA + native WKWebView (no server).
- **v1.4** — fix `app.run` (needs the call parens).
- **v1.5** — fix `WKScriptMessageHandler` protocol registration.
- **v1.6** — faded/analog pack: 4 effects + 6 palettes + 6 presets.
- **v1.7** — git repo; dithered `.icns` icon + ad-hoc signature; drag-file-onto-icon
  + File ▸ Open/Save menus (launcher `exec`, `application:openFiles:`,
  `CFBundleDocumentTypes`).
- **v1.8** — Web Worker: split `<script>` into a reusable core (`#dither-core` +
  `processWithCfg`) + a worker pool (`processViaWorker`) for image/GIF/WebM
  export, with sync fallback. Refactor verified byte-identical (20 algos × 25
  effects). Public release: README, MIT license, generic naming.
