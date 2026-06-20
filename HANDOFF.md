# Dither Engine — Handoff document

État du projet à la passation, architecture, et prochaines étapes pour Claude Code.

> **Emplacement (2026-06-20)** : le projet vit désormais dans `~/DitherEngine`
> (dépôt git initialisé), sorti du dossier de session éphémère. C'est un projet
> **distinct de Rekorboxeddd**.

## Ce que c'est

App d'image/GIF/vidéo dithering avec pipeline d'effets stackables : dithering classique (error diffusion, ordered, halftone) plus une couche d'effets analog-glitch et faded/vintage.

Tout le moteur tient dans un seul fichier HTML autonome. Le `.app` macOS est un wrapper natif minimal qui héberge ce HTML dans une `NSWindow` + `WKWebView`, avec un pont JS↔natif pour les exports (NSSavePanel).

## Fichiers à garder

```
~/DitherEngine/
├── dither-engine.html              ← LE moteur, source de vérité
├── Dither Engine.app/              ← bundle macOS (wrapper natif)
│   └── Contents/
│       ├── Info.plist              ← + CFBundleIconFile, CFBundleDocumentTypes
│       ├── Resources/
│       │   ├── dither-engine.html  ← copie du moteur
│       │   ├── main.js             ← code JXA (NSWindow + WKWebView)
│       │   └── icon.icns           ← icône dithered orb
│       └── MacOS/DitherEngine      ← launcher bash (exec osascript)
├── make_icon.py                    ← génère icon_1024.png (PNG pur, sans Pillow)
├── icon.icns / icon.iconset/       ← artefacts d'icône (iconset gitignoré)
├── DitherEngineApp-v1.6.zip        ← ancienne archive distribuable (gitignorée)
├── .gitignore
├── HANDOFF.md                      ← ce document
└── CLAUDE_CODE_PROMPT.md           ← prompt à coller dans Claude Code
```

## Fichiers à jeter (anciens artefacts)

- `DitherEngineApp.zip`, `DitherEngineApp-v1.2.zip`, `v1.3`, `v1.4`, `v1.5` — versions intermédiaires
- `DitherEngine-app.zip`, `DitherEngine.app.zip` — archives ratées (0 octets)
- `zi6o82Nv`, `ziKuom1T` — fichiers temporaires zip
- `.DS_Store` — système

## Architecture de `dither-engine.html`

⚠️ **Depuis v1.8, le HTML contient DEUX `<script>`** (avant : un seul) :
1. **`<script id="dither-core">`** (≈ lignes 222–1170) — le **cœur pur** du moteur :
   `PALETTES`, `makeNearestFn`, `extractPalette`, helpers gamma, `ALGORITHMS`,
   registre, `EFFECTS`, et **`processWithCfg(imd, cfg)`** (pipeline piloté par une
   config, sans dépendance à `state`). Ce bloc est **réinjecté tel quel dans le Web
   Worker** via son `textContent` → tout helper privé part automatiquement avec lui.
   **Ne référence rien du thread principal** (`state`, `document`, `window`) : à garder ainsi.
2. **`<script>`** (le reste) — `state`, wrappers, rendering, UI, presets, I/O, export, init.

Les numéros de ligne ci-dessous ont décalé (~+40 après EFFECTS) ; ordre conservé :

| Section | Rôle |
|---|---|
| `PALETTES` | 25 palettes (grayscales, rétro-hardware génériques, vapor, faded/vintage, etc.) |
| `makeNearestFn` / `extractPalette` | Quantification + median cut |
| Gamma helpers | Lookup tables sRGB↔linear (`sRGBtoLin`, `LinToSRGB`) |
| `ALGORITHMS` (+registre) | 20 algos : Floyd-Steinberg, Atkinson, Bayer, blue noise, halftone CMYK… |
| `EFFECTS` | 25 effets stackables avec params |
| **`processWithCfg`** | **Pipeline pur (effets→dither), partagé main thread + worker** |
| `state` | État global mutable (algo, palette, effects, etc.) |
| `buildCfg` / `processImageData` | Snapshot `state`→cfg ; wrapper sync (inchangé pour les appelants) |
| **Worker pool** | `workerPool()`/`pumpPool()`/`processViaWorker()` + `WORKER_MIN_PX`, fallback sync |
| Rendering | Render + debounce + downsample preview (reste synchrone) |
| UI / `PRESETS` / User presets | Contrôles, 21 presets, localStorage + import/export JSON |
| File loading / GIF decode | Image / GIF89a maison / vidéo · LZW + interlacing + disposal |
| Export | PNG/JPG, GIF (encodeur maison), WebM — **gros buffers/frames via le worker** |
| Samples / Init | Portraits procéduraux · bootstrap + drag-drop + raccourcis |

## Inventaire actuel

**Algorithmes (20)**
Threshold, Floyd-Steinberg (+ False), Atkinson, Burkes, Stucki, Jarvis-Judice-Ninke, Sierra (3-row, 2-row, Lite), Stevenson-Arce, Bayer 2/4/8/16, clustered dot 8×8, blue noise (void-and-cluster), random, halftone rond, CMYK halftone.

**Effets (25)**
- Color : brightness, contrast, saturation, hue rotate, invert, posterize
- Texture/structure : pixelate, blur, sharpen, vignette, noise
- Glitch (analog) : chromatic aberration, scanlines, JPEG glitch, wave displacement, tape tear, RGB desync, CRT shadow mask, chroma smear (YCbCr), slit-scan
- Faded/analog : color cast (faded), split tone, light leak, film grain (color/mono, chunky), glow/bloom

**Palettes (25)**
B&W, 4/8/16 grays, Handheld Green, Handheld Grey, CGA 0/1, EGA, Home Computer 16, Fantasy Console 16, Candy 16, Vivid 32, 8-bit Console (54), Analog Tape, Vaporwave, Phosphor green, Amber CRT, Faded Pastel, Dusk Synthetic, Hazy Analog, Warm Nostalgia, Ember, Vintage Film, Custom éditable.

**Presets (21)**
Handheld Green, Handheld Grey, Classic 1-bit, Newspaper, CMYK Print, Duplicator Pink, CRT, Fantasy Console, 8-bit Console, Home Computer, Glitch, Blue noise B&W, Neon CRT, Neon CRT (pink), Analog Glitch, Abstract Glitch, CRT phosphor, VHS dub, Faded Instant, Dusk Synthetic, Warm Nostalgia, Hazy Analog, Ember, Vintage Home Movie.

## Architecture du `.app`

Wrapper minimaliste, 100 % standard macOS, aucune dépendance (osascript + WebKit livrés avec macOS).

- **`MacOS/DitherEngine`** (bash) — résout les chemins du bundle, vérifie la présence de `dither-engine.html`/`main.js`, puis **`exec osascript -l JavaScript main.js HTML_PATH`** (logs dans `~/Library/Logs/DitherEngine.log`). ⚠️ Le `exec` est **requis** : sans lui, le bundle reste le process bash et l'Apple Event d'ouverture de fichier (drop sur l'icône) n'atteint jamais notre `NSApplication`.
- **`Resources/main.js`** (JXA) — crée `NSWindow` + `WKWebView`, injecte un user script qui (a) surcharge `window.downloadBlob` → `webkit.messageHandlers.savefile.postMessage(...)`, et (b) définit `window.loadFileFromNative(b64,name,mime)` qui reconstruit un `File` et appelle `loadFile()`. Le délégué (`DEAppDelegate`) gère `application:openFiles:`/`application:openFile:` (drop/Open With) et expose `deOpenDocument:` / `deSaveDocument:` pour les menus. `deLoadPathIntoWeb(path)` lit le fichier en NSData, le base64, et l'injecte via `evaluateJavaScript` (avec retry in-page si la page n'est pas encore prête au démarrage à froid). Menu bar : App, **Fichier (Ouvrir ⌘O / Enregistrer PNG ⌘S / Fermer ⌘W)**, Édition, Affichage, Fenêtre.
- **`Info.plist`** — `CFBundleIdentifier=local.ditherengine.app`, `LSMinimumSystemVersion=10.13`, `NSHighResolutionCapable=true`, **`CFBundleIconFile=icon`**, **`CFBundleDocumentTypes`** (public.image / public.movie / webm, role Viewer, rank Alternate). Version 1.7.

## Limitations actuelles / chantiers ouverts

1. ~~Pas d'icône custom~~ → **FAIT (v1.7)** : `icon.icns` (orb dithered, généré par `make_icon.py`) déclaré via `CFBundleIconFile`.
2. ~~Pas signée~~ → **FAIT (v1.7)** : signature ad-hoc (`codesign --force --deep --sign -`). ⚠️ **Re-signer après toute modif du bundle** (sinon signature invalide).
3. **Pas de DMG** — distribué en .zip, pas idéal pour une vraie release. `create-dmg` ou `hdiutil` recommandé si distribution.
4. ~~Single-threaded~~ → **FAIT (v1.8)** : pool de Web Workers (construit depuis le texte de `#dither-core`). L'export image pleine résolution (≥ `WORKER_MIN_PX`), l'export GIF (frames en parallèle) et WebM passent hors du thread principal, avec **fallback synchrone** si les Workers échouent. Output **byte-identique** au chemin sync (vérifié). Overhead round-trip worker ≈ 7 ms. ⚠️ Le *speedup wall-clock* réel se mesure dans l'app (Safari/WKWebView) : l'environnement de preview embarqué fausse les chiffres (GC thrash). Le *preview* reste synchrone (déjà downscalé à 1.2 MP).
5. **Pas de preview thumbnail pour les presets dans la sidebar** — détail UX.
6. **`Dither Engine` apparaît comme `osascript` dans Cmd+Tab sur certaines versions macOS** — quirk JXA. Bundler une vraie binaire Swift résoudrait ça mais nécessite Xcode CLT.
7. ~~Drag-drop d'un fichier sur l'icône~~ → **FAIT (v1.7)** : `application:openFiles:` + `exec` du launcher + `CFBundleDocumentTypes`.
8. **Pas de "Save As..." natif pour les presets** — l'import/export presets passe encore par les boutons HTML. (Le menu Fichier > Enregistrer (PNG) ⌘S déclenche l'export image, lui.)

## Prochaines étapes recommandées (par ordre de valeur perçue)

1. ~~Icône `.icns`~~ ✅ · ~~Signature ad-hoc~~ ✅ · ~~Drag-drop sur icône~~ ✅ · ~~Menu Fichier Ouvrir/Enregistrer~~ ✅ · ~~Web Worker~~ ✅ (v1.8)
2. **DMG de release** avec fond custom et background image.
3. **Effets en plus** : light leaks animés, frame jitter pour vidéo, film burns.
4. **Mesurer le speedup worker réel** dans l'app sur une vraie image 4K + un export vidéo, et ajuster `WORKER_MIN_PX` si besoin.

## Tests

Aucun test auto formel. Validation manuelle :
- Charger l'image sample portrait → tester chaque preset → vérifier sortie cohérente
- Charger un GIF court → exporter en GIF → vérifier que la sortie loop bien
- Charger une vidéo MP4 → exporter en WebM → vérifier que ça lit

Validation JS rapide en CLI : `node --check dither-engine.html` ne marche pas (HTML), faire :
```bash
node -e "const html=require('fs').readFileSync('dither-engine.html','utf8'); new Function(html.match(/<script>([\\s\\S]*?)<\\/script>/)[1]); console.log('OK')"
```

## Versions

- v1.0 — premier jet : HTML standalone, 20 algos, 15 palettes, 12 presets
- v1.1 — bundle .app avec serveur Python (abandonné, problèmes de port)
- v1.2 — refonte presets Neon CRT lisible
- v1.3 — passage à JXA + WKWebView natif (sans serveur)
- v1.4 — fix `app.run` sans parens
- v1.5 — fix protocole `WKScriptMessageHandler` (suppression `protocols:` array)
- v1.6 — pack faded/analog : 4 effets + 6 palettes + 6 presets
- v1.7 — projet déplacé dans `~/DitherEngine` (+ git) ; icône `.icns` dithered + signature ad-hoc ; drag-drop fichier sur l'icône + menu Fichier Ouvrir ⌘O / Enregistrer ⌘S (launcher passé en `exec`, délégué `application:openFiles:`, `CFBundleDocumentTypes`)
- v1.8 — Web Worker : split du `<script>` en cœur réutilisable (`#dither-core` + `processWithCfg`) + pool de workers (`processViaWorker`) pour l'export image/GIF/WebM, fallback synchrone. Refactor vérifié byte-identique (20 algos × 25 effets).
