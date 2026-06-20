// Dither Engine — native macOS wrapper via JXA + WKWebView.
// No HTTP server. Exports route through a JS→native bridge that opens NSSavePanel.

ObjC.import('Cocoa');
ObjC.import('WebKit');
ObjC.import('Foundation');

// Force WebKit classes & protocols to be fully realized in the runtime BEFORE
// we register any subclasses that conform to them. Without this, JXA can throw
// "protocol does not exist (-2700)" because the bridge is lazy.
(function forceWebKitLoad(){
    try { $.WKWebView; $.WKUserContentController; $.WKUserScript; $.WKWebViewConfiguration; } catch(e) {}
})();

// ============ Register subclasses up-front (more reliable across macOS versions) ============

// File-save bridge: receives {name, mime, data(base64)} from the page and writes via NSSavePanel.
// We intentionally DO NOT declare `protocols: ['WKScriptMessageHandler']` — JXA's protocol
// resolution is fragile, and ObjC dispatch finds the method by selector regardless of formal
// protocol conformance (WebKit calls -respondsToSelector: under the hood).
ObjC.registerSubclass({
    name: 'DEMsgHandler',
    superclass: 'NSObject',
    methods: {
        'userContentController:didReceiveScriptMessage:': {
            types: ['void', ['id', 'id']],
            implementation: function(controller, message) {
                try {
                    var body = message.body;
                    var name = ObjC.unwrap(body.objectForKey('name')) || 'export';
                    var b64  = ObjC.unwrap(body.objectForKey('data')) || '';
                    var panel = $.NSSavePanel.savePanel;
                    panel.nameFieldStringValue = name;
                    panel.canCreateDirectories = true;
                    panel.title = "Enregistrer l'export";
                    var result = panel.runModal();
                    if (result !== 1) return; // NSModalResponseOK
                    var url = panel.URL;
                    var data = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 1);
                    data.writeToURLAtomically(url, true);
                } catch (e) {
                    $.NSLog('DitherEngine save error: %@', String(e));
                    var alert = $.NSAlert.alloc.init;
                    alert.messageText = 'Export';
                    alert.informativeText = String(e);
                    alert.runModal();
                }
            }
        }
    }
});

// Map a file path to a MIME type the engine's loadFile() understands.
function deMimeForPath(p) {
    p = String(p).toLowerCase();
    if (/\.png$/.test(p))        return 'image/png';
    if (/\.(jpg|jpeg)$/.test(p)) return 'image/jpeg';
    if (/\.gif$/.test(p))        return 'image/gif';
    if (/\.webp$/.test(p))       return 'image/webp';
    if (/\.bmp$/.test(p))        return 'image/bmp';
    if (/\.(mp4|m4v)$/.test(p))  return 'video/mp4';
    if (/\.webm$/.test(p))       return 'video/webm';
    if (/\.mov$/.test(p))        return 'video/quicktime';
    return 'application/octet-stream';
}

// Read a file natively, base64 it, and hand it to the page. Retries in-page until
// loadFileFromNative exists (cold start: the open event can beat the page load).
function deLoadPathIntoWeb(path) {
    try {
        var ns = $.NSString.alloc.initWithUTF8String(path);
        var data = $.NSData.dataWithContentsOfFile(ns);
        if (!data || data.length === 0) return;
        var b64  = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
        var name = ObjC.unwrap(ns.lastPathComponent);
        var mime = deMimeForPath(path);
        var refs = $.__ditherEngineRefs;
        if (!refs || !refs.webView) return;
        var js = '(function go(){ if (window.loadFileFromNative) { window.loadFileFromNative('
            + JSON.stringify(b64) + ',' + JSON.stringify(name) + ',' + JSON.stringify(mime)
            + '); } else { setTimeout(go, 120); } })();';
        refs.webView.evaluateJavaScriptCompletionHandler(js, null);
    } catch (e) {
        $.NSLog('DitherEngine open error: %@', String(e));
    }
}

// App delegate: quit when window closes + handle files opened via Dock/Finder.
ObjC.registerSubclass({
    name: 'DEAppDelegate',
    superclass: 'NSObject',
    methods: {
        'applicationShouldTerminateAfterLastWindowClosed:': {
            types: ['bool', ['id']],
            implementation: function(sender) { return true; }
        },
        // File(s) dropped on the app icon or "Open With > Dither Engine".
        'application:openFiles:': {
            types: ['void', ['id', 'id']],
            implementation: function(sender, files) {
                try {
                    var n = files.count;
                    for (var i = 0; i < n; i++) {
                        deLoadPathIntoWeb(ObjC.unwrap(files.objectAtIndex(i)));
                    }
                } catch (e) { $.NSLog('openFiles err: %@', String(e)); }
                try { sender.replyToOpenOrPrint(0); } catch (e) {}
            }
        },
        'application:openFile:': {
            types: ['bool', ['id', 'id']],
            implementation: function(sender, file) {
                deLoadPathIntoWeb(ObjC.unwrap(file));
                return true;
            }
        },
        // Fichier > Ouvrir… (Cmd+O), routed via the responder chain (nil target).
        'deOpenDocument:': {
            types: ['void', ['id']],
            implementation: function(sender) {
                var panel = $.NSOpenPanel.openPanel;
                panel.canChooseFiles = true;
                panel.canChooseDirectories = false;
                panel.allowsMultipleSelection = false;
                panel.title = 'Ouvrir une image, un GIF ou une vidéo';
                if (panel.runModal() !== 1) return;
                deLoadPathIntoWeb(ObjC.unwrap(panel.URLs.objectAtIndex(0).path));
            }
        },
        // Fichier > Enregistrer (PNG)… (Cmd+S) -> triggers the engine export,
        // which flows back through downloadBlob -> NSSavePanel.
        'deSaveDocument:': {
            types: ['void', ['id']],
            implementation: function(sender) {
                var refs = $.__ditherEngineRefs;
                if (refs && refs.webView) {
                    refs.webView.evaluateJavaScriptCompletionHandler(
                        "if (typeof exportImage === 'function') exportImage('png');", null);
                }
            }
        }
    }
});

// ============ Entry point ============
function run(argv) {
    try {
        return main(argv);
    } catch (e) {
        $.NSLog('DitherEngine fatal: %@', String(e) + ' / stack=' + (e && e.stack ? e.stack : 'none'));
        // also print to stderr so the bash launcher captures it
        var err = $.NSFileHandle.fileHandleWithStandardError;
        var msg = $.NSString.alloc.initWithUTF8String('FATAL: ' + String(e) + '\n');
        err.writeData(msg.dataUsingEncoding(4 /* NSUTF8StringEncoding */));
        throw e;
    }
}

function main(argv) {
    var htmlPath = argv && argv[0];
    if (!htmlPath) throw new Error('No HTML path passed');

    var app = $.NSApplication.sharedApplication;
    // NSApplicationActivationPolicyRegular = 0
    app.setActivationPolicy(0);

    // ---------- Menu bar ----------
    buildMenu(app);

    // ---------- Window ----------
    var screen = $.NSScreen.mainScreen;
    var sf = screen.visibleFrame;
    var winW = Math.min(1400, sf.size.width  - 80);
    var winH = Math.min(900,  sf.size.height - 80);
    var winX = sf.origin.x + (sf.size.width  - winW) / 2;
    var winY = sf.origin.y + (sf.size.height - winH) / 2;
    var rect = $.NSMakeRect(winX, winY, winW, winH);
    // titled(1) | closable(2) | miniaturizable(4) | resizable(8)
    var styleMask = 1 | 2 | 4 | 8;
    // NSBackingStoreBuffered = 2
    var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, styleMask, 2, false);
    win.title = 'Dither Engine';
    win.setFrameAutosaveName('DitherEngineMainWindow');
    win.releasedWhenClosed = false;
    win.minSize = $.NSMakeSize(800, 500);

    // ---------- WebView ----------
    var userContent = $.WKUserContentController.alloc.init;

    var shim = ''
      + '(function(){\n'
      + '  if (!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.savefile)) return;\n'
      + '  // Native->JS: rebuild a File from base64 and feed it to the engine\'s loadFile().\n'
      + '  window.loadFileFromNative = function(b64, name, mime){\n'
      + '    try {\n'
      + '      var bin = atob(b64);\n'
      + '      var bytes = new Uint8Array(bin.length);\n'
      + '      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);\n'
      + '      var f = new File([bytes], name, {type: mime});\n'
      + '      if (typeof loadFile === "function") loadFile(f);\n'
      + '    } catch(e){ alert("Ouverture : " + e.message); }\n'
      + '  };\n'
      + '  function installShim(){\n'
      + '    window.downloadBlob = async function(blob, name) {\n'
      + '      try {\n'
      + '        var buf = await blob.arrayBuffer();\n'
      + '        var bytes = new Uint8Array(buf);\n'
      + '        var s = "";\n'
      + '        var chunk = 0x4000;\n'
      + '        for (var i = 0; i < bytes.length; i += chunk) {\n'
      + '          s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i+chunk, bytes.length)));\n'
      + '        }\n'
      + '        var b64 = btoa(s);\n'
      + '        window.webkit.messageHandlers.savefile.postMessage({name: name, mime: blob.type || "application/octet-stream", data: b64});\n'
      + '      } catch(e) { alert("Erreur d\\u0027export : " + e.message); }\n'
      + '    };\n'
      + '  }\n'
      + '  if (document.readyState === "loading") {\n'
      + '    document.addEventListener("DOMContentLoaded", installShim);\n'
      + '  } else { installShim(); }\n'
      + '})();\n';
    // WKUserScriptInjectionTimeAtDocumentEnd = 1
    var userScript = $.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly(shim, 1, true);
    userContent.addUserScript(userScript);

    var msgHandler = $.DEMsgHandler.alloc.init;
    userContent.addScriptMessageHandlerName(msgHandler, 'savefile');

    var config = $.WKWebViewConfiguration.alloc.init;
    config.userContentController = userContent;
    try { config.preferences.setValueForKey(true, 'developerExtrasEnabled'); } catch(e) {}

    var contentBounds = win.contentView.bounds;
    var webView = $.WKWebView.alloc.initWithFrameConfiguration(contentBounds, config);
    // width(2) + height(16) sizable
    webView.setAutoresizingMask(2 | 16);

    var htmlURL = $.NSURL.fileURLWithPath(htmlPath);
    var folder  = htmlURL.URLByDeletingLastPathComponent;
    webView.loadFileURLAllowingReadAccessToURL(htmlURL, folder);

    win.contentView.addSubview(webView);
    win.makeKeyAndOrderFront(null);

    var appDel = $.DEAppDelegate.alloc.init;
    app.delegate = appDel;

    // Keep strong refs so nothing gets garbage collected
    $.__ditherEngineRefs = { win: win, webView: webView, msgHandler: msgHandler, appDel: appDel, userContent: userContent };

    app.activateIgnoringOtherApps(true);

    // CRITICAL: parens! Otherwise this is a property access, not a method call → script returns → app dies.
    app.run();
}

function buildMenu(app) {
    var main = $.NSMenu.alloc.init;

    // Application menu
    var appItem = $.NSMenuItem.alloc.init;
    main.addItem(appItem);
    var appMenu = $.NSMenu.alloc.init;
    appMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('À propos de Dither Engine', 'orderFrontStandardAboutPanel:', ''));
    appMenu.addItem($.NSMenuItem.separatorItem);
    appMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Masquer', 'hide:', 'h'));
    var hideOthers = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Masquer les autres', 'hideOtherApplications:', 'h');
    // option(1<<19) + command(1<<20)
    hideOthers.keyEquivalentModifierMask = (1 << 19) | (1 << 20);
    appMenu.addItem(hideOthers);
    appMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Tout afficher', 'unhideAllApplications:', ''));
    appMenu.addItem($.NSMenuItem.separatorItem);
    appMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Quitter Dither Engine', 'terminate:', 'q'));
    appItem.submenu = appMenu;

    // File menu
    var fileItem = $.NSMenuItem.alloc.init;
    main.addItem(fileItem);
    var fileMenu = $.NSMenu.alloc.initWithTitle('Fichier');
    fileMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Ouvrir…', 'deOpenDocument:', 'o'));
    fileMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Enregistrer (PNG)…', 'deSaveDocument:', 's'));
    fileMenu.addItem($.NSMenuItem.separatorItem);
    fileMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Fermer la fenêtre', 'performClose:', 'w'));
    fileItem.submenu = fileMenu;

    // Edit menu — essential for clipboard & color pickers
    var editItem = $.NSMenuItem.alloc.init;
    main.addItem(editItem);
    var editMenu = $.NSMenu.alloc.initWithTitle('Édition');
    editMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Annuler', 'undo:', 'z'));
    var redo = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Rétablir', 'redo:', 'z');
    // shift(1<<17) + command(1<<20)
    redo.keyEquivalentModifierMask = (1 << 17) | (1 << 20);
    editMenu.addItem(redo);
    editMenu.addItem($.NSMenuItem.separatorItem);
    editMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Couper', 'cut:', 'x'));
    editMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Copier', 'copy:', 'c'));
    editMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Coller', 'paste:', 'v'));
    editMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Tout sélectionner', 'selectAll:', 'a'));
    editItem.submenu = editMenu;

    // View menu
    var viewItem = $.NSMenuItem.alloc.init;
    main.addItem(viewItem);
    var viewMenu = $.NSMenu.alloc.initWithTitle('Affichage');
    viewMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Recharger', 'reload:', 'r'));
    var fullscreen = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Plein écran', 'toggleFullScreen:', 'f');
    fullscreen.keyEquivalentModifierMask = (1 << 19) | (1 << 20);
    viewMenu.addItem(fullscreen);
    viewItem.submenu = viewMenu;

    // Window menu
    var winItem = $.NSMenuItem.alloc.init;
    main.addItem(winItem);
    var winMenu = $.NSMenu.alloc.initWithTitle('Fenêtre');
    winMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Réduire', 'performMiniaturize:', 'm'));
    winMenu.addItem($.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Zoom', 'performZoom:', ''));
    winItem.submenu = winMenu;
    app.windowsMenu = winMenu;

    app.mainMenu = main;
}
