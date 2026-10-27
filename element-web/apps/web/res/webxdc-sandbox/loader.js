/*
 * Haven: the webxdc sandbox's loader page.
 *
 * Haven opens this page in a frame on the sandbox's own origin, with "#t=<token>&o=<Haven's origin>".
 * It starts the sandbox's service worker (sw.js), tells Haven it's ready, takes the game's files
 * from Haven and hands them to the service worker, which keeps them and serves them to the game,
 * and then opens the game. The game's files never come from the network.
 *
 * The service worker stores the files itself: some browsers keep a frame's storage apart from its
 * service worker's, so files this page stored could be invisible to it.
 */
"use strict";

(async () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("t") || "";
    const parentOrigin = params.get("o") || "";
    if (!/^[a-z0-9]{16,64}$/.test(token) || !parentOrigin || window.parent === window) return;

    const base = new URL("./", location.href);
    const fail = (message) => window.parent.postMessage({ type: "xdc.error", token, message }, parentOrigin);

    let worker;
    try {
        const registration = await navigator.serviceWorker.register(new URL("sw.js", base).href, {
            scope: base.pathname,
        });
        // After an update, the new worker has to take over before the game opens: the old one
        // would still answer otherwise, from a cache laid out the way it knew.
        const next = registration.installing || registration.waiting;
        if (next) {
            await new Promise((resolve) => {
                const check = () => (next.state === "activated" || next.state === "redundant") && resolve();
                next.addEventListener("statechange", check);
                check();
            });
        }
        worker = (await navigator.serviceWorker.ready).active;
    } catch (e) {
        fail("The game sandbox could not start: " + (e && e.message ? e.message : e));
        return;
    }

    // Haven may not be listening yet when this page is ready, so it's told again until the files come.
    let received = false;
    const ready = () => window.parent.postMessage({ type: "xdc.ready", token }, parentOrigin);
    const retry = setInterval(() => (received ? clearInterval(retry) : ready()), 500);
    setTimeout(() => clearInterval(retry), 30_000);

    window.addEventListener("message", async (event) => {
        if (event.source !== window.parent || event.origin !== parentOrigin) return;
        const data = event.data;
        if (!data || data.type !== "xdc.files" || data.token !== token || !Array.isArray(data.files)) return;
        if (received) return;
        received = true;
        clearInterval(retry);
        try {
            const meta = { ...data.meta, token, parentOrigin };
            const reply = new MessageChannel();
            const stored = new Promise((resolve, reject) => {
                reply.port1.onmessage = (e) =>
                    e.data && e.data.ok ? resolve() : reject(new Error(e.data && e.data.error));
            });
            worker.postMessage({ type: "xdc.store", token, files: data.files, meta }, [reply.port2]);
            await stored;
            location.replace(new URL("app/" + token + "/index.html", base).href);
        } catch (e) {
            fail("The game could not be opened: " + (e && e.message ? e.message : e));
        }
    });

    ready();
})();
