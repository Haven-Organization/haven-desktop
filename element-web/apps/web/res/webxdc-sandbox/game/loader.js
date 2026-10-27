/*
 * Haven: the bundled webxdc sandbox, which the web app uses when no sandbox URL is configured.
 *
 * Haven opens this page, served with Haven itself, in a frame sandboxed without allow-same-origin.
 * The browser gives such a frame an origin of its own, so the game can't reach Haven's storage or
 * pages although it comes from Haven's server. Such a frame can't have a service worker, so nothing
 * serves the game's files: Haven sends them here, they're kept as blob: URLs, and the game's
 * requests for them are pointed at those. This page's Content-Security-Policy allows nothing else,
 * so the game has no internet access.
 *
 * Opened with "#t=<token>&o=<Haven's origin>", it tells Haven it's ready, takes the game's files,
 * and writes the game's index.html in place of itself. The game's root folder is this page's own
 * (".../game/"), so the game's own addresses for its files still make sense.
 *
 * Some games need what only a sandbox on a real origin has: IndexedDB, or pages of their own to go
 * between. This tells Haven ("xdc.limit"), and Haven says the game needs a sandbox URL.
 */
"use strict";

(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("t") || "";
    const parentOrigin = params.get("o") || "";
    if (!/^[a-z0-9]{16,64}$/.test(token) || !parentOrigin || window.parent === window) return;

    const post = (message) => window.parent.postMessage({ ...message, token }, parentOrigin);

    // Haven may not be listening yet when this page is ready, so it's told again until the files come.
    let received = false;
    const ready = () => post({ type: "xdc.ready" });
    const retry = setInterval(() => (received ? clearInterval(retry) : ready()), 500);
    setTimeout(() => clearInterval(retry), 30_000);

    window.addEventListener("message", (event) => {
        if (received || event.source !== window.parent || event.origin !== parentOrigin) return;
        const data = event.data;
        if (!data || data.type !== "xdc.files" || data.token !== token || !Array.isArray(data.files)) return;
        received = true;
        clearInterval(retry);
        try {
            start(data.files, data.meta || {});
        } catch (e) {
            post({ type: "xdc.error", message: "The game could not be opened: " + (e && e.message ? e.message : e) });
        }
    });
    ready();

    function start(list, meta) {
        const base = new URL("./", location.href);
        const details = { ...meta, token, parentOrigin, base: base.href };
        const has = Object.prototype.hasOwnProperty;
        const decoder = new TextDecoder();

        /** The game's files by name ("sub/file.js"). */
        const files = Object.create(null);
        for (const [name, bytes, type] of list) {
            files[String(name)] = { bytes, type: String(type || "application/octet-stream") };
        }
        if (!files["index.html"]) throw new Error("it has no index.html");
        files["webxdc.js"] = { text: self.xdcRuntime.shim(details), type: "text/javascript" };

        const encodePath = (name) => name.split("/").map(encodeURIComponent).join("/");
        /** A file's address in the game's root folder. */
        const addressOf = (name) => new URL(encodePath(name), base).href;

        /** The file a URL means, if it's one of the game's: in its folder, or by an absolute path. */
        const nameOf = (url, from) => {
            let parsed;
            try {
                parsed = new URL(url, from || document.baseURI);
            } catch {
                return null;
            }
            if (parsed.origin !== base.origin) return null;
            let path = parsed.pathname;
            path = path.startsWith(base.pathname) ? path.slice(base.pathname.length) : path.slice(1);
            try {
                path = decodeURIComponent(path);
            } catch {
                return null;
            }
            if (path === "" || path.endsWith("/")) path += "index.html";
            return has.call(files, path) ? path : null;
        };

        const blobs = Object.create(null);
        const making = new Set();
        /** The blob: URL of a file, made the first time it's asked for. */
        const blobOf = (name) => {
            if (blobs[name]) return blobs[name];
            if (making.has(name)) return addressOf(name); // a stylesheet that imports itself
            making.add(name);
            const file = files[name];
            let body = file.text ?? file.bytes;
            if (/\.css$/i.test(name)) body = rewriteCss(text(file), addressOf(name));
            else if (/\.m?js$/i.test(name) && file.text === undefined)
                body = rewriteScript(text(file), addressOf(name));
            blobs[name] = URL.createObjectURL(new Blob([body], { type: file.type }));
            making.delete(name);
            return blobs[name];
        };
        const text = (file) => file.text ?? decoder.decode(file.bytes);

        /** A URL the game uses, pointed at the file's blob when it's one of the game's files. */
        const redirect = (url, from) => {
            if (url === null || url === undefined) return url;
            const value = String(url);
            if (/^(blob|data|about|javascript):/i.test(value.trim())) return url;
            const name = nameOf(value, from);
            if (!name) return url;
            const hash = value.indexOf("#");
            return blobOf(name) + (hash >= 0 ? value.slice(hash) : "");
        };

        function rewriteCss(css, from) {
            return css
                .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, url) => `url(${q}${redirect(url, from)}${q})`)
                .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, url) => `@import ${q}${redirect(url, from)}${q}`);
        }

        // A script's own address is a blob: URL, which "./x.js" can't be resolved against, so its
        // relative module names are made whole (the import map below points them at the blobs), and
        // import.meta.url is its address in the game's folder.
        function rewriteScript(source, from) {
            return source
                .split("import.meta.url")
                .join(JSON.stringify(from))
                .replace(
                    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{0,2}\/[^"'\n]*)\2/g,
                    (m, keyword, q, specifier) => {
                        try {
                            return keyword + q + new URL(specifier, from).href + q;
                        } catch {
                            return m;
                        }
                    },
                );
        }

        const rewriteSrcset = (value) =>
            String(value)
                .split(",")
                .map((candidate) => candidate.replace(/^(\s*)(\S+)/, (m, space, url) => space + redirect(url)))
                .join(",");

        installRedirects({ redirect, rewriteCss, rewriteSrcset, files, blobOf, addressOf });
        const isOtherPage = installLimits(nameOf);

        // The game's page, its addresses pointed at the blobs, written in place of this one.
        const source = text(files["index.html"]);
        const doc = new DOMParser().parseFromString(source, "text/html");
        for (const el of doc.querySelectorAll("*"))
            fixElement(el, redirect, rewriteCss, rewriteSrcset, el.setAttribute);
        for (const style of doc.querySelectorAll("style")) style.textContent = rewriteCss(style.textContent, base.href);

        const imports = {};
        for (const name of Object.keys(files)) {
            if (!/\.m?js$/i.test(name)) continue;
            imports[addressOf(name)] = blobOf(name);
            imports[new URL("/" + encodePath(name), base).href] ??= blobOf(name);
        }
        const head = doc.head;
        // First, so it holds for everything after: the same as this page's, without 'self' (which
        // this page needs for its own scripts, and the game doesn't).
        const csp = doc.createElement("meta");
        csp.httpEquiv = "Content-Security-Policy";
        csp.content = document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            .content.replace(/ 'self'/g, "");
        const importMap = doc.createElement("script");
        importMap.type = "importmap";
        importMap.textContent = JSON.stringify({ imports });
        const guard = doc.createElement("script");
        guard.textContent = self.xdcRuntime.pageGuard(details);
        head.prepend(csp, importMap, guard);

        const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
        const html = (doctype ? doctype[0] : "") + doc.documentElement.outerHTML;
        document.open();
        document.write(html);
        document.close();
        watchPage({ redirect, rewriteCss, rewriteSrcset, isOtherPage });
    }

    /** Points an element's addresses at the game's blobs. */
    function fixElement(el, redirect, rewriteCss, rewriteSrcset, setAttribute) {
        const tag = el.localName;
        for (const attr of ["src", "href", "poster", "data", "srcset", "style", "xlink:href"]) {
            if (!el.hasAttribute(attr)) continue;
            if (
                (attr === "href" && (tag === "a" || tag === "area" || tag === "base")) ||
                (attr === "data" && tag !== "object")
            ) {
                continue;
            }
            const value = el.getAttribute(attr);
            let fixed;
            if (attr === "srcset") fixed = rewriteSrcset(value);
            else if (attr === "style") fixed = rewriteCss(value, document.baseURI);
            else fixed = redirect(value);
            if (fixed !== value) setAttribute.call(el, attr, fixed);
        }
    }

    /** Points the game's requests made while it runs at the blobs. */
    function installRedirects({ redirect, rewriteCss, rewriteSrcset, files, blobOf, addressOf }) {
        // A response says it came from the file's address in the game's folder, not its blob: some
        // games keep that address. Ruffle names a Flash game's saves after it, so with the blob's,
        // which is new every run, its saves would never be found again.
        const addressFor = (url) => {
            try {
                return new URL(String(url), document.baseURI).href.split("#")[0];
            } catch {
                return String(url);
            }
        };
        const realFetch = window.fetch;
        window.fetch = function (input, init) {
            const asked = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
            const url = redirect(asked);
            if (url === asked) return realFetch.call(this, input, init);
            const request = input instanceof Request ? new Request(url, input) : url;
            return realFetch.call(this, request, init).then((response) => {
                Object.defineProperty(response, "url", { configurable: true, value: addressFor(asked) });
                return response;
            });
        };
        const open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            const args = Array.prototype.slice.call(arguments);
            args[1] = redirect(url);
            if (args[1] !== url) {
                Object.defineProperty(this, "responseURL", { configurable: true, value: addressFor(url) });
            } else {
                delete this.responseURL;
            }
            return open.apply(this, args);
        };

        const setters = [
            ["HTMLScriptElement", "src"],
            ["HTMLImageElement", "src"],
            ["HTMLMediaElement", "src"],
            ["HTMLSourceElement", "src"],
            ["HTMLTrackElement", "src"],
            ["HTMLInputElement", "src"],
            ["HTMLEmbedElement", "src"],
            ["HTMLIFrameElement", "src"],
            ["HTMLLinkElement", "href"],
            ["HTMLObjectElement", "data"],
            ["HTMLVideoElement", "poster"],
            ["HTMLImageElement", "srcset", rewriteSrcset],
            ["HTMLSourceElement", "srcset", rewriteSrcset],
        ];
        for (const [type, prop, rewrite] of setters) {
            const proto = window[type] && window[type].prototype;
            const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.set) continue;
            Object.defineProperty(proto, prop, {
                configurable: true,
                enumerable: desc.enumerable,
                get: desc.get,
                set(value) {
                    desc.set.call(this, rewrite ? rewrite(value) : redirect(value));
                },
            });
        }

        const setAttribute = Element.prototype.setAttribute;
        const setAttributeNS = Element.prototype.setAttributeNS;
        const fixValue = (el, name, value) => {
            const attr = String(name).toLowerCase();
            const tag = el.localName;
            if (attr === "srcset") return rewriteSrcset(value);
            if (attr === "style") return rewriteCss(String(value), document.baseURI);
            if (attr === "src" || attr === "poster" || attr === "xlink:href") return redirect(value);
            if (attr === "href" && tag !== "a" && tag !== "area" && tag !== "base") return redirect(value);
            if (attr === "data" && tag === "object") return redirect(value);
            return value;
        };
        Element.prototype.setAttribute = function (name, value) {
            return setAttribute.call(this, name, fixValue(this, name, value));
        };
        Element.prototype.setAttributeNS = function (ns, name, value) {
            return setAttributeNS.call(this, ns, name, fixValue(this, name, value));
        };

        // Styles set from script (el.style.backgroundImage = "url(sprite.png)") are caught by
        // watchPage(), as changes to the style attribute: browsers keep those properties on each
        // element, not where they could be changed for all.
        const setProperty = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
            return setProperty.call(
                this,
                name,
                value == null ? value : rewriteCss(String(value), document.baseURI),
                priority,
            );
        };
        const insertRule = CSSStyleSheet.prototype.insertRule;
        CSSStyleSheet.prototype.insertRule = function (rule, index) {
            return insertRule.call(this, rewriteCss(String(rule), document.baseURI), index);
        };

        if (window.Audio) {
            const RealAudio = window.Audio;
            window.Audio = function Audio(src) {
                return arguments.length ? new RealAudio(redirect(src)) : new RealAudio();
            };
            window.Audio.prototype = RealAudio.prototype;
        }
        if (window.FontFace) {
            const RealFontFace = window.FontFace;
            window.FontFace = function FontFace(family, source, descriptors) {
                const fixed = typeof source === "string" ? rewriteCss(source, document.baseURI) : source;
                return new RealFontFace(family, fixed, descriptors);
            };
            window.FontFace.prototype = RealFontFace.prototype;
        }

        // A worker's script is a blob too, so it gets the same pointing for its own requests.
        let workerTable;
        const prelude = (address) => {
            if (!workerTable) {
                workerTable = {};
                for (const name of Object.keys(files)) workerTable[addressOf(name)] = blobOf(name);
            }
            return `(() => {
    const table = ${JSON.stringify(workerTable)};
    const point = (url) => {
        try {
            const abs = new URL(String(url), ${JSON.stringify(address)}).href.split("#")[0].split("?")[0];
            return table[abs] || url;
        } catch (e) {
            return url;
        }
    };
    const realFetch = self.fetch;
    self.fetch = function (input, init) {
        return realFetch.call(this, input instanceof Request ? input : point(input), init);
    };
    if (self.importScripts) {
        const realImport = self.importScripts;
        self.importScripts = function () { return realImport.apply(this, Array.prototype.map.call(arguments, point)); };
    }
    if (self.XMLHttpRequest) {
        const open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            const args = Array.prototype.slice.call(arguments);
            args[1] = point(url);
            return open.apply(this, args);
        };
    }
})();
`;
        };
        for (const type of ["Worker", "SharedWorker"]) {
            const RealWorker = window[type];
            if (!RealWorker) continue;
            const wrapped = function (url, options) {
                const target = redirect(url);
                if (target === url || typeof url !== "string") return new RealWorker(url, options);
                let address;
                try {
                    address = new URL(String(url), document.baseURI).href;
                } catch {
                    address = String(url);
                }
                const start =
                    options && options.type === "module"
                        ? `await import(${JSON.stringify(target)});`
                        : `importScripts(${JSON.stringify(target)});`;
                const boot = new Blob([prelude(address) + start], { type: "text/javascript" });
                return new RealWorker(URL.createObjectURL(boot), options);
            };
            wrapped.prototype = RealWorker.prototype;
            window[type] = wrapped;
        }

        // An origin of its own has no cookies or sessionStorage: give the game harmless ones.
        try {
            Object.defineProperty(Document.prototype, "cookie", {
                configurable: true,
                get: () => "",
                set: () => {},
            });
        } catch {
            // Some browsers don't let this be changed; the game gets the browser's error.
        }
        const session = Object.create(null);
        const sessionStorage = {
            getItem: (key) => (String(key) in session ? session[String(key)] : null),
            setItem: (key, value) => {
                session[String(key)] = String(value);
            },
            removeItem: (key) => {
                delete session[String(key)];
            },
            clear: () => Object.keys(session).forEach((key) => delete session[key]),
            key: (n) => Object.keys(session)[n] ?? null,
            get length() {
                return Object.keys(session).length;
            },
        };
        try {
            Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => sessionStorage });
        } catch {
            // As above.
        }
        // Changing the page's address isn't allowed in an origin of its own; most games don't need it to work.
        for (const method of ["pushState", "replaceState"]) {
            const real = History.prototype[method];
            History.prototype[method] = function () {
                try {
                    return real.apply(this, arguments);
                } catch {
                    return undefined;
                }
            };
        }
    }

    /**
     * What the bundled sandbox can't give a game: Haven is told when the game tries it. Returns
     * whether a URL is another of the game's pages, for watchPage().
     */
    function installLimits(nameOf) {
        const limit = (what) => post({ type: "xdc.limit", what });
        const refuse = (what) => () => {
            limit(what);
            throw new DOMException("This needs a webxdc sandbox URL.", "SecurityError");
        };
        const idb = {
            open: refuse("indexeddb"),
            deleteDatabase: refuse("indexeddb"),
            databases: () => Promise.resolve([]),
            cmp: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
        };
        try {
            Object.defineProperty(window, "indexedDB", { configurable: true, get: () => idb });
        } catch {
            // Then the browser's own error reaches the game.
        }

        // Going to another of the game's pages: the frame would load it from Haven's server instead.
        const isOtherPage = (url) => {
            const name = nameOf(url);
            return !!name && /\.html?$/i.test(name) && name !== "index.html";
        };
        if (window.navigation) {
            window.navigation.addEventListener("navigate", (event) => {
                if (event.destination && isOtherPage(event.destination.url)) limit("pages");
            });
        }
        return isOtherPage;
    }

    /** After the game's page is written: the parts that need its document. */
    function watchPage({ redirect, rewriteCss, rewriteSrcset, isOtherPage }) {
        const setAttribute = Element.prototype.setAttribute;
        // Elements made from HTML text (innerHTML and the like) don't go through the setters above.
        const fix = (el) => fixElement(el, redirect, rewriteCss, rewriteSrcset, setAttribute);
        new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === "attributes") {
                    const value = record.target.getAttribute("style");
                    if (value && value.includes("url(")) fix(record.target);
                    continue;
                }
                for (const node of record.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    fix(node);
                    for (const child of node.querySelectorAll("*")) fix(child);
                }
            }
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
        // And one that loaded before it was fixed gets another go.
        document.addEventListener(
            "error",
            (event) => {
                const el = event.target;
                if (el && el.nodeType === 1) fix(el);
            },
            true,
        );

        document.addEventListener(
            "click",
            (event) => {
                const link = event.target && event.target.closest && event.target.closest("a[href], area[href]");
                if (!link || !isOtherPage(link.href)) return;
                event.preventDefault();
                post({ type: "xdc.limit", what: "pages" });
            },
            true,
        );
    }
})();
