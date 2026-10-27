/*
 * Haven: the desktop app's sandbox for webxdc games.
 *
 * A game runs in a frame at webxdc://<game id>/, an origin of its own for each game. The page
 * there (the web app's webxdc-sandbox/ files, served from the app itself) gets the game's files
 * from Haven and serves them with a service worker that refuses everything else. On top of that,
 * the app itself keeps games off the network: nothing a game frame (or a frame inside it, or a
 * worker it starts) asks for outside webxdc:// is let through, a game frame can't be navigated
 * away from its sandbox, and games get no permissions (camera, microphone, location and so on).
 */

import path from "node:path";

export const WEBXDC_SCHEME = "webxdc";

/** The sandbox's own files. Everything else under a game's origin comes from its service worker. */
const SANDBOX_FILES = new Set(["loader.html", "loader.js", "sw.js", "runtime.js"]);
const GAME_HOST = /^[a-z0-9]{16,64}$/;

/** The file to serve for a webxdc:// request, or undefined for one there's no file for. */
export function webxdcSandboxFile(requestUrl: string, webappPath: string): string | undefined {
    let url: URL;
    try {
        url = new URL(requestUrl);
    } catch {
        return undefined;
    }
    if (url.protocol !== `${WEBXDC_SCHEME}:` || !GAME_HOST.test(url.hostname)) return undefined;
    const name = url.pathname.replace(/^\//, "");
    if (!SANDBOX_FILES.has(name)) return undefined;
    return path.join(webappPath, "webxdc-sandbox", name);
}

/** The parts of Electron's WebFrameMain used here. */
export interface FrameLike {
    readonly url: string;
    readonly parent: FrameLike | null;
}

function isWebxdcUrl(url: string | undefined | null): boolean {
    return !!url && url.startsWith(`${WEBXDC_SCHEME}:`);
}

/** Whether a frame is a game's, or inside one. */
export function isInWebxdcFrame(frame: FrameLike | null | undefined): boolean {
    try {
        for (let current = frame; current; current = current.parent) {
            if (isWebxdcUrl(current.url)) return true;
        }
    } catch {
        // A frame that's gone can't be asked. The request's referrer still tells a game's apart.
        return false;
    }
    return false;
}

interface RequestDetails {
    url: string;
    referrer?: string;
    frame?: FrameLike | null;
}

/** Whether a request comes from a game and leaves its sandbox, so must be canceled. */
export function isWebxdcRequestBlocked(details: RequestDetails): boolean {
    if (isWebxdcUrl(details.url)) return false;
    return isWebxdcUrl(details.referrer) || isInWebxdcFrame(details.frame);
}

/** Whether a frame navigation would take a game out of its sandbox. */
export function isWebxdcNavigationBlocked(frame: FrameLike | null | undefined, targetUrl: string): boolean {
    return !isWebxdcUrl(targetUrl) && isInWebxdcFrame(frame);
}

/** Whether a permission is asked for by a game. */
export function isWebxdcPermissionRequest(requestingUrl: string | undefined): boolean {
    return isWebxdcUrl(requestingUrl);
}
