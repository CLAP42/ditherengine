# Prompt à coller dans Claude Code

Procédure et prompts prêts à l'emploi pour reprendre le projet dans Claude Code.

## Mise en place

1. Ouvrir un terminal
2. `cd` dans le dossier où sont `dither-engine.html`, `Dither Engine.app/`, `HANDOFF.md`
3. Lancer `claude` (Claude Code)
4. Coller le prompt ci-dessous

## Prompt initial (à coller en premier)

```
Lis HANDOFF.md, regarde la structure du dossier, puis fais-moi une
synthèse en 5 lignes : (1) ce qui marche, (2) ce qui ne marche pas,
(3) les 3 chantiers les plus impactants pour mon usage perso,
(4) ce dont tu aurais besoin de moi pour avancer, (5) ce que tu
proposes de faire en premier si je te dis "go".

Ne modifie rien encore, c'est un état des lieux.
```

Une fois la synthèse reçue, choisissez un des prompts ci-dessous selon ce que vous voulez faire.

---

## Prompt A — Polir le .app (icône + signature + DMG)

```
Objectif : transformer Dither Engine.app en une vraie app Mac qui se
distribue proprement, pour mon usage perso (pas besoin de notarisation
Apple, juste pas de friction au lancement).

Plan que je te propose, ajuste si tu vois mieux :

1. Génère une icône .icns à partir d'un design simple — texte "DE"
   ou un motif dithering en 1024×1024, palette néon/CRT. Tu peux
   utiliser sips + iconutil qui sont sur macOS, ou Python+Pillow.
   Place-la dans Contents/Resources/icon.icns et déclare-la dans
   Info.plist (CFBundleIconFile).

2. Signature ad-hoc :
   codesign --force --deep --sign - "Dither Engine.app"
   Vérifie avec : codesign -dv --verbose=4 "Dither Engine.app"

3. Crée un DMG monté avec fond custom + alias /Applications +
   l'app au centre. Utilise create-dmg si dispo, sinon hdiutil.
   Sortie : DitherEngine.dmg.

4. Mets à jour HANDOFF.md avec ce qui a changé.

Vas-y, montre-moi tes choix au fur et à mesure pour l'icône avant
de tout finaliser.
```

## Prompt B — Drag-drop + menus natifs

```
Objectif : que je puisse glisser une image sur l'icône de Dither
Engine.app dans le Dock ou Finder pour l'ouvrir directement, et
que les menus Fichier > Ouvrir / Enregistrer marchent comme une
vraie app Mac.

À faire dans Contents/Resources/main.js :

1. Implémente NSApplicationDelegate avec
   application:openFile: et application:openFiles: qui injectent
   le fichier dans le moteur via webView.evaluateJavaScript(...).
   Côté HTML, je veux que ça réutilise loadFile(file) déjà existante
   — tu auras besoin de fetcher le fichier en blob côté JS depuis
   le path natif.

2. Déclare les types acceptés dans Info.plist via
   CFBundleDocumentTypes (PNG, JPG, GIF, MP4, WEBM).

3. Ajoute "Ouvrir…" (Cmd+O) et "Enregistrer sous…" (Cmd+S) dans
   le menu Fichier de buildMenu(), wireés au moteur.

4. Teste en glissant une image sur l'icône, en double-cliquant un
   .png depuis Finder avec "Ouvrir avec > Dither Engine".

Le pont JS↔natif actuel utilise messageHandlers.savefile pour
les exports — réutilise le même pattern pour ouvrir des fichiers.
```

## Prompt C — Effets en plus

```
Objectif : ajouter 3-5 effets qui me manquent dans le moteur de
dithering, puis créer 2 presets qui les combinent.

Lis EFFECTS dans dither-engine.html (autour de la ligne 661) pour
comprendre le format : chaque effet a name, defaults, params (avec
min/max/step), et apply(buf, w, h, params).

Idées d'effets à implémenter, je choisirai :

1. frame_burn  — taches blanches/orange brûlées comme une bobine
   abîmée, à des positions aléatoires fixes (seed)
2. tape_warp   — distorsion verticale localisée façon bande vidéo
   qui flotte (utile pour vidéo)
3. lens_distort — distorsion radiale en barillet ou coussinet
4. focus_blur  — blur radial qui préserve une zone nette
   (clic sur l'image pour définir le focus ?)
5. rotated_halftone — comme halftone existant mais avec angle
6. duotone — quantise sur 2 couleurs avec rampe lisse
7. liquify — déformation locale au curseur

Avant de coder, fais-moi un mock textuel de chaque effet (params,
résultat attendu) pour que je dise lequel garder.

Une fois implémentés, ajoute-les à la liste fx-add-select, teste
chaque effet en isolation, puis crée 2 presets stylés qui les
combinent. Mets à jour HANDOFF.md.
```

## Prompt D — Performance Web Worker

```
Objectif : pouvoir traiter des images de 4K+ sans bloquer la UI.

Plan :

1. Crée un Web Worker inline (via Blob URL) qui charge processImageData
   et la chaîne ALGORITHMS + EFFECTS. Attention : les effets et
   algos sont des fonctions, donc tu devras les sérialiser (Function
   .toString()) ou les inclure dans le code du worker.

2. Côté main thread, refactore renderPreview pour postMessage au
   worker avec ImageData transférable (transfer ArrayBuffer), et
   afficher quand le worker répond.

3. Ajoute un indicateur de progression visible.

4. Garde une voie synchrone fallback pour les petits buffers (<200k px)
   où l'overhead worker n'en vaut pas la peine.

5. Pour la vidéo et le GIF, pipeline frame-by-frame parallélisable :
   queue de N workers, chaque frame est traitée indépendamment.

Mesure le speedup sur une image 4096×2160 avant/après.
```

## Prompt E — Atelier libre

```
Lis HANDOFF.md et dis-moi ce que tu améliorerais en priorité si
tu avais 2h pour rendre cet outil plus utilisable au quotidien
pour quelqu'un qui fait du dithering artistique. Liste 5 idées
classées par valeur perçue / coût d'implémentation, justifie
chacune en 1-2 phrases.

Ne touche rien avant que je valide.
```

---

## Conseils généraux pour la session Claude Code

- **Travaille petit à petit.** Le HTML fait 2200+ lignes — demande à Claude Code de lire la section concernée avant de modifier, pas tout le fichier.
- **Garde le pont JS↔natif intact.** `window.downloadBlob` est surchargée par `main.js` dans le contexte WKWebView. Si tu changes downloadBlob côté HTML, garde la signature `(blob, name)`.
- **Teste après chaque modif** en ouvrant `dither-engine.html` dans Safari (le moteur marche en standalone, sans le wrapper) puis dans l'app .app.
- **Si Claude Code propose une refonte massive**, demande-lui d'abord un petit diff. Le fichier est touffu mais cohérent, des refontes "propres" risquent de casser des trucs subtils (gamma, serpentine, etc.).

## Mots-clés utiles pour Claude Code

- "Lis seulement la section X de dither-engine.html avant de modifier"
- "Avant de coder, donne-moi un plan en 5 étapes"
- "Mets à jour HANDOFF.md une fois fini"
- "Teste avec `node -e ...` (cf. fin de HANDOFF.md)"
