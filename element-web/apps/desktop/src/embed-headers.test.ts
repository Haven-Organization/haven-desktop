/*
 * Haven: tests for the embedded players' header changes.
 */

import { describe, expect, it } from "vitest";

import { embedRequestHeaders, embedResponseHeaders } from "./embed-headers";

const inApp = { frame: { top: { url: "vector://vector/webapp/" } } } as never;
const inBrowser = { frame: { top: { url: "https://app.example.org/" } } } as never;
const APP_ID = "org.example.app";

describe("embedRequestHeaders", () => {
    const request = (url: string, extra: object = inApp, requestHeaders: Record<string, string> = {}) =>
        embedRequestHeaders({ url, resourceType: "subFrame", requestHeaders, ...(extra as object) } as never, APP_ID);

    it("gives YouTube's player in the app a referrer", () => {
        expect(request("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1")).toEqual({
            Referer: "https://org.example.app/",
        });
    });

    it("leaves other requests alone", () => {
        expect(request("https://www.youtube-nocookie.com/embed/x", inBrowser)).toBeUndefined();
        expect(request("https://www.youtube.com/watch?v=x")).toBeUndefined();
        expect(request("https://example.org/embed/x")).toBeUndefined();
        expect(request("https://www.youtube-nocookie.com/embed/x", inApp, { Referer: "https://a/" })).toBeUndefined();
        expect(
            embedRequestHeaders(
                { url: "https://www.youtube-nocookie.com/embed/x", resourceType: "xhr", requestHeaders: {}, ...inApp },
                APP_ID,
            ),
        ).toBeUndefined();
    });
});

describe("embedResponseHeaders", () => {
    const response = (url: string, extra: object = inApp) =>
        embedResponseHeaders({
            url,
            resourceType: "subFrame",
            responseHeaders: {
                "Content-Security-Policy": ["frame-ancestors https://vector; default-src 'self'"],
                "X-Frame-Options": ["SAMEORIGIN"],
                "Content-Type": ["text/html"],
            },
            ...(extra as object),
        } as never);

    it("drops the framing policy from Twitch's player in the app", () => {
        expect(response("https://player.twitch.tv/?channel=alice&parent=vector")).toEqual({
            "Content-Security-Policy": ["default-src 'self'"],
            "Content-Type": ["text/html"],
        });
    });

    it("leaves other responses alone", () => {
        expect(response("https://player.twitch.tv/?channel=alice", inBrowser)).toBeUndefined();
        expect(response("https://www.twitch.tv/alice")).toBeUndefined();
    });
});
