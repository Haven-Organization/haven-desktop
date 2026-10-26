/*
 * Haven: lets YouTube and Twitch players embedded in the app (rich embeds on links) play.
 *
 * The app is served from vector://vector, which neither service expects:
 * - YouTube's embedded player refuses to play ("Error 153") without an http(s) referrer. YouTube
 *   asks apps that embed it to identify themselves with a referrer of https://<app id>.
 * - Twitch only lets its player be framed by the page named in its `parent` parameter, and builds
 *   a frame-ancestors policy of https://<parent>, which a vector:// page can never match.
 * Both changes apply only to those players' own frame documents, inside the app's own windows.
 */

import { type OnBeforeSendHeadersListenerDetails, type OnHeadersReceivedListenerDetails } from "electron";

const YOUTUBE_EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "www.youtube.com"]);
const TWITCH_PLAYER_HOSTS = new Set(["player.twitch.tv", "clips.twitch.tv"]);

type Details = Pick<OnBeforeSendHeadersListenerDetails, "url" | "resourceType" | "frame" | "webContents">;

/** Whether the request is a frame inside one of the app's own vector:// pages. */
function isFrameInApp(details: Details): boolean {
    if (details.resourceType !== "subFrame") return false;
    let topUrl: string | undefined;
    try {
        topUrl = details.frame?.top?.url ?? details.webContents?.getURL();
    } catch {
        // The frame can be gone by the time this runs.
        topUrl = details.webContents?.getURL();
    }
    return !!topUrl?.startsWith("vector://");
}

function hostOf(url: string): string | undefined {
    try {
        return new URL(url).hostname;
    } catch {
        return undefined;
    }
}

/**
 * Request headers to send for an embedded YouTube player inside the app, or undefined to leave the
 * request alone.
 */
export function embedRequestHeaders(
    details: Details & Pick<OnBeforeSendHeadersListenerDetails, "requestHeaders">,
    appId: string,
): Record<string, string> | undefined {
    const host = hostOf(details.url);
    if (!host || !YOUTUBE_EMBED_HOSTS.has(host) || !new URL(details.url).pathname.startsWith("/embed/")) {
        return undefined;
    }
    if (!isFrameInApp(details)) return undefined;
    if (Object.keys(details.requestHeaders).some((h) => h.toLowerCase() === "referer")) return undefined;
    return { ...details.requestHeaders, Referer: `https://${appId}/` };
}

/**
 * Response headers for an embedded Twitch player inside the app, without the frame-ancestors
 * policy that would block it, or undefined to leave the response alone.
 */
export function embedResponseHeaders(
    details: Details & Pick<OnHeadersReceivedListenerDetails, "responseHeaders">,
): Record<string, string[]> | undefined {
    const host = hostOf(details.url);
    if (!host || !TWITCH_PLAYER_HOSTS.has(host) || !details.responseHeaders) return undefined;
    if (!isFrameInApp(details)) return undefined;

    const headers: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(details.responseHeaders)) {
        const lower = name.toLowerCase();
        if (lower === "x-frame-options") continue;
        if (lower === "content-security-policy") {
            const kept = values
                .map((policy) =>
                    policy
                        .split(";")
                        .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
                        .join(";")
                        .trim(),
                )
                .filter((policy) => policy.length > 0);
            if (kept.length) headers[name] = kept;
            continue;
        }
        headers[name] = values;
    }
    return headers;
}
