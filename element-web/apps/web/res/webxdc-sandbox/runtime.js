/*
 * Haven: the code that runs in a webxdc game's own pages, shared by both sandboxes: the service
 * worker one (sw.js, on the desktop app and a configured sandbox URL) and the bundled one (game/).
 *
 *   pageGuard(details)  source of a script that runs before any of the game's: takes away WebRTC,
 *                       tells Haven the page is the game's, and keeps localStorage as the save
 *   shim(details)       source of webxdc.js, the API a game uses (https://webxdc.org/docs/spec/)
 *
 * details: { token, parentOrigin, selfAddr, selfName, maxSize, realtimeMaxSize, saveKey, save,
 * saveUpdated, base }. base is the URL of the game's root folder, when it isn't app/<token>/.
 */
"use strict";

(function (root) {
    function pageGuard(details) {
        const meta = JSON.stringify({
            token: details.token,
            parentOrigin: details.parentOrigin,
            saveKey: typeof details.saveKey === "string" ? details.saveKey : "",
            save: details.save && typeof details.save === "object" ? details.save : null,
            saveUpdated: Number(details.saveUpdated) || 0,
            base: typeof details.base === "string" ? details.base : "",
        });
        return `(function () {
        var meta = ${meta.replace(/</g, "\\u003c")};
        function post(message) {
            message.token = meta.token;
            try { window.parent.postMessage(message, meta.parentOrigin); } catch (e) {}
        }
        ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCSessionDescription", "RTCIceCandidate",
         "RTCRtpSender", "RTCRtpReceiver", "RTCRtpTransceiver", "RTCCertificate"].forEach(function (name) {
            try { Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
        });
        post({ type: "xdc.page" });
        // Only when the page is really being left: a Flash game's page sends its own (see below).
        window.addEventListener("pagehide", function (e) { if (e.isTrusted) post({ type: "xdc.leaving" }); });
        window.addEventListener("error", function (e) {
            post({ type: "xdc.crash", message: String((e && e.message) || "error") });
        });

        /* The game's own localStorage, kept as the player's save (see Haven's utils/webxdc.ts). It's
         * filled from the save when the game starts, and sent back a moment after it changes and when
         * the game is left. A copy stays in this browser, under the game's prefix, with when it was
         * last changed: a game's next page starts from whichever is newer, that or the save. In the
         * bundled sandbox the browser gives the game no localStorage at all, so there's only the save.
         *
         * The game's address changes with every run (its token) and with the room it's in, and some
         * games put it in their keys: Ruffle names a Flash save after the .swf's URL. So the address is
         * kept in the save as a placeholder, and the game sees this run's address in its place.
         *
         * Haven can ask for the save at once (its Save button, and before it closes the game): the
         * page sends what's changed, then says it's done. Before that, an "xdc-save" event lets a page
         * write what it's still holding, as the Flash player's does. */
        var saveNow = function () {};
        window.addEventListener("message", function (event) {
            if (event.source !== window.parent || event.origin !== meta.parentOrigin) return;
            var data = event.data;
            if (!data || data.token !== meta.token || data.type !== "xdc.flush") return;
            try { window.dispatchEvent(new Event("xdc-save")); } catch (e) {}
            saveNow();
            post({ type: "xdc.flushed", id: data.id });
        });
        (function () {
            var real = null;
            try { real = window.localStorage; } catch (e) {}
            if (!meta.saveKey) return;
            var prefix = "xdc:" + meta.saveKey + ":", stamp = "xdc-updated:" + meta.saveKey;
            var data = {}, i, k;
            var localUpdated = real ? Number(real.getItem(stamp)) || 0 : 0;
            if (!real || (meta.save && meta.saveUpdated >= localUpdated)) {
                data = meta.save || {};
            } else {
                for (i = 0; i < real.length; i++) {
                    k = real.key(i);
                    if (k && k.indexOf(prefix) === 0) data[k.slice(prefix.length)] = real.getItem(k);
                }
            }
            // The game's root: given by the bundled sandbox, or app/<token>/ in the service worker's.
            var root = null;
            if (meta.base) {
                try { root = new URL(meta.base); } catch (e) {}
            } else {
                var appPath = "/app/" + meta.token + "/";
                var at = location.pathname.indexOf(appPath);
                if (at >= 0) root = { origin: location.origin, host: location.host, hostname: location.hostname,
                    pathname: location.pathname.slice(0, at + appPath.length) };
            }
            var has = Object.prototype.hasOwnProperty;
            // In the save, the game's address is a placeholder, the same in either sandbox and on any
            // site. Longest first. Ruffle, for one, uses the host name without its port; with or
            // without, it's the same name, and the game is shown the host name.
            var saving = !root ? [] : [
                [root.origin + root.pathname, "{xdc-url}/"],
                [root.host + root.pathname, "{xdc-host}/"],
                [root.hostname + root.pathname, "{xdc-host}/"],
            ];
            var showing = !root ? [] : [
                ["{xdc-url}/", root.origin + root.pathname],
                ["{xdc-host}/", root.hostname + root.pathname],
            ];
            function swap(text, places) {
                for (var n = 0; n < places.length; n++) text = text.split(places[n][0]).join(places[n][1]);
                return text;
            }
            function saved(key) { return swap(String(key), saving); }
            function shown(key) { return swap(key, showing); }
            // Saves from before the two were one name.
            Object.keys(data).forEach(function (key) {
                if (key.indexOf("{xdc-hostname}/") < 0) return;
                var renamed = key.split("{xdc-hostname}/").join("{xdc-host}/");
                if (!has.call(data, renamed)) data[renamed] = data[key];
                delete data[key];
            });
            var timer = null, dirty = localUpdated > meta.saveUpdated && Object.keys(data).length > 0;
            var leaving = false;
            function local(key, value) {
                if (!real) return;
                try {
                    if (value === null) real.removeItem(prefix + key);
                    else real.setItem(prefix + key, value);
                    real.setItem(stamp, String(Date.now()));
                } catch (e) {}
            }
            function flush() {
                clearTimeout(timer);
                timer = null;
                if (!dirty) return;
                dirty = false;
                post({ type: "xdc.save", data: data });
            }
            saveNow = flush;
            // A write while the game is being closed goes now: there's no later. That includes the
            // Flash player's, which writes its saves as the page is left, after this has sent its own.
            function changed() {
                dirty = true;
                clearTimeout(timer);
                if (leaving || document.visibilityState === "hidden") flush();
                else timer = setTimeout(flush, 3000);
            }
            var methods = Object.create(Storage.prototype, {
                getItem: { value: function (key) { key = saved(key); return has.call(data, key) ? data[key] : null; } },
                setItem: { value: function (key, value) {
                    key = saved(key); value = String(value);
                    if (data[key] === value) return;
                    data[key] = value; local(key, value); changed();
                } },
                removeItem: { value: function (key) {
                    key = saved(key);
                    if (!has.call(data, key)) return;
                    delete data[key]; local(key, null); changed();
                } },
                clear: { value: function () {
                    Object.keys(data).forEach(function (key) { local(key, null); });
                    data = {}; changed();
                } },
                key: { value: function (n) { var keys = Object.keys(data); return n >= 0 && n < keys.length ? shown(keys[n]) : null; } },
                length: { get: function () { return Object.keys(data).length; } },
            });
            var store = Object.create(methods);
            // localStorage.foo and localStorage["foo"] too, as with the real one.
            var view = new Proxy(store, {
                get: function (t, p) { return typeof p === "symbol" || p in t ? t[p] : t.getItem(p); },
                set: function (t, p, v) { if (typeof p === "symbol" || p in t) return false; t.setItem(p, v); return true; },
                deleteProperty: function (t, p) { t.removeItem(p); return true; },
                has: function (t, p) { return p in t || (typeof p === "string" && has.call(data, saved(p))); },
                ownKeys: function () { return Object.keys(data).map(shown); },
                getOwnPropertyDescriptor: function (t, p) {
                    if (typeof p !== "string" || !has.call(data, saved(p))) return undefined;
                    return { value: data[saved(p)], writable: true, enumerable: true, configurable: true };
                },
            });
            Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return view; } });
            window.addEventListener("pagehide", function (e) {
                if (e.isTrusted) leaving = true;
                flush();
            });
            document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
            if (dirty) timer = setTimeout(flush, 3000);
        })();
    })();`;
    }

    /** webxdc.js: the API a game uses (https://webxdc.org/docs/spec/), talking to Haven. */
    function shim(details) {
        const meta = JSON.stringify({
            token: details.token,
            parentOrigin: details.parentOrigin,
            selfAddr: String(details.selfAddr || ""),
            selfName: String(details.selfName || ""),
            maxSize: Number(details.maxSize) || 0,
            realtimeMaxSize: Number(details.realtimeMaxSize) || 0,
        });
        return `(function () {
        "use strict";
        var meta = ${meta.replace(/</g, "\\u003c")};
        var listener = null;
        var waiting = [];
        var realtime = null;
        function post(message) {
            message.token = meta.token;
            window.parent.postMessage(message, meta.parentOrigin);
        }
        window.addEventListener("message", function (event) {
            if (event.source !== window.parent || event.origin !== meta.parentOrigin) return;
            var data = event.data;
            if (!data || data.token !== meta.token) return;
            if (data.type === "xdc.updates" && listener) {
                data.updates.forEach(function (update) {
                    try { listener(update); } catch (e) { console.error(e); }
                });
            } else if (data.type === "xdc.realtime" && realtime && realtime.listener && data.data instanceof Uint8Array) {
                try { realtime.listener(data.data); } catch (e) { console.error(e); }
            } else if (data.type === "xdc.realtimeUnavailable") {
                console.warn("webxdc: realtime isn't available in this room");
            } else if (data.type === "xdc.listening") {
                var done = waiting;
                waiting = [];
                done.forEach(function (resolve) { resolve(); });
            }
        });
        window.webxdc = {
            selfAddr: meta.selfAddr,
            selfName: meta.selfName,
            sendUpdateInterval: 1000,
            sendUpdateMaxSize: meta.maxSize,
            sendUpdate: function (update, descr) {
                var copy = JSON.parse(JSON.stringify(update));
                post({ type: "xdc.sendUpdate", update: copy, descr: descr == null ? "" : String(descr) });
            },
            setUpdateListener: function (callback, serial) {
                listener = callback;
                return new Promise(function (resolve) {
                    waiting.push(resolve);
                    post({ type: "xdc.listen", serial: Number(serial) || 0 });
                });
            },
            getAllUpdates: function () { return Promise.resolve([]); },
            joinRealtimeChannel: function () {
                if (realtime) throw new Error("Already joined a realtime channel. Leave it first.");
                var channel = { listener: null, left: false };
                realtime = channel;
                post({ type: "xdc.rtJoin" });
                return {
                    setListener: function (callback) {
                        if (channel.left) throw new Error("The realtime channel has been left.");
                        channel.listener = callback;
                    },
                    send: function (data) {
                        if (channel.left) throw new Error("The realtime channel has been left.");
                        if (!(data instanceof Uint8Array)) throw new Error("Realtime data must be a Uint8Array.");
                        if (data.length > meta.realtimeMaxSize) throw new Error("The realtime packet is too large.");
                        post({ type: "xdc.rtSend", data: data });
                    },
                    leave: function () {
                        if (channel.left) return;
                        channel.left = true;
                        channel.listener = null;
                        if (realtime === channel) realtime = null;
                        post({ type: "xdc.rtLeave" });
                    },
                };
            },
            sendToChat: function () { return Promise.reject(new Error("sendToChat is not supported here")); },
            importFiles: function () { return Promise.reject(new Error("importFiles is not supported here")); },
        };
    })();`;
    }

    root.xdcRuntime = { pageGuard: pageGuard, shim: shim };
})(self);
