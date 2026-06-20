# Dither Engine

A single-file image / GIF / video **dithering** tool with a stackable effects
pipeline. Runs entirely in the browser (no build step, no dependencies), and
ships as a tiny native macOS app wrapper.

- **20 dithering algorithms** — error diffusion (Floyd–Steinberg, Atkinson,
  Burkes, Stucki, Jarvis–Judice–Ninke, Sierra, Stevenson–Arce…), ordered
  (Bayer 2/4/8/16, clustered dot), blue noise (void-and-cluster), random,
  round halftone, CMYK halftone.
- **25 stackable effects** — color (brightness, contrast, saturation, hue,
  invert, posterize), texture (pixelate, blur, sharpen, vignette, noise),
  analog glitch (chromatic aberration, scanlines, JPEG glitch, wave displace,
  tape tear, RGB desync, CRT shadow mask, chroma smear, slit-scan), and
  faded/vintage (color cast, split tone, light leak, film grain, glow/bloom).
- **25 palettes** — B&W, grayscales, retro-hardware-style sets, vaporwave,
  phosphor/amber CRT, and faded/vintage tones. Custom palette editable in-app.
- **24 presets** combining algorithm + palette + effect stacks.
- **Inputs**: images, animated GIF (custom GIF89a decoder), and video.
- **Exports**: PNG, JPG, animated GIF (custom encoder), and WebM.

## Usage

### In a browser (works anywhere)

Open [`dither-engine.html`](dither-engine.html) in any modern browser. The whole
engine is self-contained in that one file — drag an image/GIF/video onto the
window, tweak, and export.

### macOS app

`Dither Engine.app` wraps the same HTML in a native `NSWindow` + `WKWebView`
(via JXA — no server, no dependencies beyond what ships with macOS):

- **Drag a file onto the Dock/Finder icon**, or use **File ▸ Open… (⌘O)** /
  **Save (PNG)… (⌘S)**.
- The app is **ad-hoc signed** (not notarized). On first launch, macOS Gatekeeper
  may warn — **right-click the app ▸ Open**, or re-sign locally:
  ```bash
  codesign --force --deep --sign - "Dither Engine.app"
  ```

> Note: the `.app`'s code signature is intentionally **not** committed
> (`_CodeSignature/` is gitignored). Re-sign after cloning or editing the bundle.

## Performance

Heavy work (full-resolution image export, GIF/video frame batches) runs off the
main thread on a **Web Worker pool**, so the UI stays responsive on large files.
The worker shares the exact same engine code as the main thread (the
`#dither-core` script is injected verbatim into the worker), and falls back to
synchronous processing if Workers are unavailable.

## Project layout

```
dither-engine.html        The engine — source of truth (two <script> blocks:
                          #dither-core = pure engine reused by the worker)
Dither Engine.app/        Native macOS wrapper (JXA + WKWebView)
make_icon.py              Regenerates the dithered app icon (pure stdlib, no deps)
HANDOFF.md                Architecture notes & internals
```

Regenerate the icon:

```bash
python3 make_icon.py                       # -> icon_1024.png
mkdir -p icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon_1024.png --out icon.iconset/icon_${s}x${s}.png
  sips -z $((s*2)) $((s*2)) icon_1024.png --out icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns icon.iconset -o icon.icns
cp icon.icns "Dither Engine.app/Contents/Resources/icon.icns"
```

## License

[MIT](LICENSE) © 2026 Romuald Varin (CLAP42)
