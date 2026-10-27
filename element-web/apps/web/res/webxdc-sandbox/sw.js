/*
 * Haven: the webxdc sandbox's service worker.
 *
 * Serves a game's files from the cache loader.js filled with them, and nothing else. The webxdc spec
 * requires that a game has no internet access, so a request for anything that isn't one of the
 * game's own files is refused, never passed on to the network. Every page it serves also carries
 * a Content-Security-Policy that keeps the page's own requests on this origin, which still holds
 * if the game unregisters this worker.
 *
 * Paths, under the folder this worker is served from:
 *   loader.html, loader.js, sw.js, runtime.js  the sandbox itself, from the server
 *   app/<token>/<file>             a file of the game opened with that token
 * A game that asks for a file by an absolute path ("/style.css") gets its own file of that name
 * (from the root of its files, wherever the sandbox itself is), found from the page that asked.
 */
"use strict";

// pageGuard() and shim(): the code that runs in the game's pages, shared with the bundled sandbox.
importScripts("runtime.js");
const { pageGuard, shim } = self.xdcRuntime;

const BASE = new URL("./", self.location.href).pathname;
const APP = BASE + "app/";
const OWN_FILES = new Set([BASE + "loader.html", BASE + "loader.js", BASE + "sw.js", BASE + "runtime.js"]);
const TOKEN = /^[a-z0-9]{16,64}$/;
/** The Cache API only takes http(s) URLs, so files are kept under these stand-ins (as loader.js does). */
const KEYS = "https://webxdc.invalid/";

const CSP = [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:",
    "style-src 'self' 'unsafe-inline' data: blob:",
    "connect-src 'self' data: blob:",
    "form-action 'none'",
    "base-uri 'self'",
].join("; ");

/** Page -> token, for a request that doesn't say which game it's from. */
const clientTokens = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => event.respondWith(handle(event)));

// loader.js hands over a game's files; they're kept here, where they're served from.
self.addEventListener("message", (event) => {
    const data = event.data;
    const port = event.ports[0];
    if (!data || data.type !== "xdc.store" || !port || !TOKEN.test(data.token) || !Array.isArray(data.files)) return;
    event.waitUntil(
        store(data.token, data.files, data.meta).then(
            () => port.postMessage({ ok: true }),
            (e) => port.postMessage({ error: String((e && e.message) || e) }),
        ),
    );
});

const DAY = 24 * 60 * 60 * 1000;

async function store(token, files, meta) {
    // Games other sessions left behind. Every game played here shares this origin unless the
    // sandbox gives each its own hostname.
    try {
        for (const name of await caches.keys()) {
            if (!name.startsWith("xdc-") || name === "xdc-" + token) continue;
            const old = await (await caches.open(name)).match(KEYS + "meta/" + name.slice(4));
            const created = old ? (await old.json()).created : 0;
            if (!created || Date.now() - created > DAY) await caches.delete(name);
        }
    } catch {
        // Only tidying up.
    }

    const cache = await caches.open("xdc-" + token);
    await Promise.all(
        files.map(([name, bytes, type]) =>
            cache.put(
                KEYS + "app/" + token + "/" + String(name).split("/").map(encodeURIComponent).join("/"),
                new Response(bytes, { headers: { "Content-Type": String(type) } }),
            ),
        ),
    );
    await cache.put(
        KEYS + "meta/" + token,
        new Response(JSON.stringify({ ...meta, token, created: Date.now() }), {
            headers: { "Content-Type": "application/json" },
        }),
    );
}

function refuse() {
    return new Response("Blocked: a webxdc game has no internet access.", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
    });
}

function notFound(why) {
    return new Response("Not found" + (why ? ": " + why : ""), {
        status: 404,
        headers: { "Content-Type": "text/plain" },
    });
}

/** The token in an app/<token>/ URL, if it is one. */
function tokenOf(href) {
    if (!href) return undefined;
    let url;
    try {
        url = new URL(href);
    } catch {
        return undefined;
    }
    if (url.origin !== self.location.origin || !url.pathname.startsWith(APP)) return undefined;
    const token = url.pathname.slice(APP.length).split("/")[0];
    return TOKEN.test(token) ? token : undefined;
}

async function handle(event) {
    const request = event.request;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return refuse();
    if (request.method !== "GET" && request.method !== "HEAD") return refuse();

    const path = url.pathname;
    if (OWN_FILES.has(path)) return fetch(request);

    if (path.startsWith(APP)) {
        const token = tokenOf(url.href);
        if (!token) return notFound();
        if (request.mode === "navigate" && event.resultingClientId) clientTokens.set(event.resultingClientId, token);
        return serve(token, path.slice(APP.length + token.length + 1));
    }

    // An absolute path: the game's own file of that name, from the root of its files.
    const token = tokenOf(request.referrer) ?? clientTokens.get(event.clientId);
    if (token) return serve(token, path.slice(1));
    return refuse();
}

async function serve(token, encodedPath) {
    const cacheName = "xdc-" + token;
    if (!(await caches.has(cacheName))) return notFound("this game's files aren't in the sandbox");
    let segments;
    try {
        segments = encodedPath.split("/").map(decodeURIComponent);
    } catch {
        return notFound();
    }
    if (segments.some((s) => s === ".." || s === ".")) return notFound();
    let name = segments.join("/");
    if (name === "" || name.endsWith("/")) name += "index.html";

    const cache = await caches.open(cacheName);
    const meta = await cache.match(KEYS + "meta/" + token);
    if (!meta) return notFound("this game's details aren't in the sandbox");
    const details = await meta.json();

    if (name === "webxdc.js") return script(shim(details));

    const file = await cache.match(KEYS + "app/" + token + "/" + name.split("/").map(encodeURIComponent).join("/"));
    if (!file) return notFound(name);

    const type = file.headers.get("Content-Type") || "application/octet-stream";
    const headers = new Headers({
        "Content-Type": type,
        "Content-Security-Policy": CSP,
        "X-DNS-Prefetch-Control": "off",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
    });
    if (!type.startsWith("text/html")) return new Response(file.body, { headers });

    // Pages get a first script that runs before any of the game's own: it takes away WebRTC (the
    // one way out that a Content-Security-Policy can't close) and tells Haven the page is one of
    // the game's, so Haven can tell when the frame has been sent somewhere else.
    const html = await file.text();
    const guard = "<script>" + pageGuard(details) + "</script>";
    const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
    const body = doctype ? doctype[0] + guard + html.slice(doctype[0].length) : guard + html;
    return new Response(body, { headers });
}

function script(source) {
    return new Response(source, {
        headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Content-Security-Policy": CSP,
            "X-Content-Type-Options": "nosniff",
        },
    });
}
