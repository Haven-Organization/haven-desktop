/*
 * Haven: tests for rich embed link detection.
 */

import { describe, expect, it } from "vitest";
import { type IPreviewUrlResponse } from "matrix-js-sdk/src/matrix";

import { getRichEmbedTarget, hasPreviewText, parseTimeOffset, previewImageOnly } from "./richEmbeds";

const options = { parentHost: "app.example.org", dark: false };
const target = (url: string) => getRichEmbedTarget(url, options);
/** Server previews in tests only carry the fields that matter to them. */
const serverPreview = (fields: Record<string, unknown>) => fields as unknown as IPreviewUrlResponse;

describe("getRichEmbedTarget", () => {
    describe("YouTube", () => {
        it.each([
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        ])("embeds %s", (url) => {
            expect(target(url)).toMatchObject({
                kind: "youtube",
                siteKey: "youtube.com",
                src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
                aspectRatio: 16 / 9,
            });
        });

        it("keeps the start time and playlist", () => {
            expect(target("https://youtu.be/dQw4w9WgXcQ?t=1m30s&list=PL123_abc")?.src).toBe(
                "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90&list=PL123_abc",
            );
        });

        it("embeds Shorts as portrait", () => {
            expect(target("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.aspectRatio).toBe(9 / 16);
        });

        it.each([
            "https://www.youtube.com/",
            "https://www.youtube.com/@channel",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/playlist?list=PL123",
        ])("ignores %s", (url) => {
            expect(target(url)).toBeNull();
        });
    });

    describe("Twitch", () => {
        it("embeds a channel with the page as parent", () => {
            expect(target("https://www.twitch.tv/SomeStreamer")).toMatchObject({
                kind: "twitch",
                siteKey: "twitch.tv",
                src: "https://player.twitch.tv/?channel=somestreamer&parent=app.example.org",
            });
        });

        it("embeds a past broadcast with its time", () => {
            expect(target("https://www.twitch.tv/videos/123456789?t=1h2m3s")?.src).toBe(
                "https://player.twitch.tv/?video=v123456789&parent=app.example.org&time=1h2m3s",
            );
        });

        it.each([
            "https://clips.twitch.tv/FunnyClipSlug-abc123",
            "https://www.twitch.tv/somestreamer/clip/FunnyClipSlug-abc123",
        ])("embeds the clip %s", (url) => {
            expect(target(url)?.src).toBe(
                "https://clips.twitch.tv/embed?clip=FunnyClipSlug-abc123&parent=app.example.org",
            );
        });

        it.each([
            "https://www.twitch.tv/",
            "https://www.twitch.tv/directory",
            "https://www.twitch.tv/settings",
            "https://www.twitch.tv/somestreamer/about",
        ])("ignores %s", (url) => {
            expect(target(url)).toBeNull();
        });
    });

    describe("X", () => {
        it.each([
            "https://x.com/alice/status/1234567890",
            "https://twitter.com/alice/status/1234567890",
            "https://mobile.twitter.com/alice/status/1234567890?s=20",
            "https://x.com/alice/status/1234567890/photo/1",
            "https://fxtwitter.com/alice/status/1234567890",
            "https://x.com/i/status/1234567890",
        ])("embeds %s", (url) => {
            expect(target(url)).toMatchObject({
                kind: "x",
                siteKey: "x.com",
                src: "https://platform.twitter.com/embed/Tweet.html?id=1234567890&dnt=true&theme=light",
            });
        });

        it("follows the dark theme", () => {
            expect(getRichEmbedTarget("https://x.com/alice/status/1", { ...options, dark: true })?.src).toContain(
                "theme=dark",
            );
        });

        it.each(["https://x.com/alice", "https://x.com/home", "https://x.com/alice/status/abc"])("ignores %s", (url) => {
            expect(target(url)).toBeNull();
        });
    });

    describe("direct media", () => {
        it("embeds an image link, keyed by its host", () => {
            expect(target("https://images.example.org/photos/cat.JPG?size=large")).toMatchObject({
                kind: "image",
                siteKey: "images.example.org",
                src: "https://images.example.org/photos/cat.JPG?size=large",
            });
        });

        it("embeds a video link", () => {
            expect(target("https://www.example.org/clip.webm")).toMatchObject({
                kind: "video",
                siteKey: "example.org",
            });
        });

        it("plays imgur's gifv as its mp4", () => {
            expect(target("https://i.imgur.com/abc123.gifv")).toMatchObject({
                kind: "video",
                src: "https://i.imgur.com/abc123.mp4",
            });
        });

        it("ignores plain http media, which the page would block", () => {
            expect(target("http://example.org/cat.png")).toBeNull();
        });

        it("ignores other pages", () => {
            expect(target("https://example.org/article")).toBeNull();
            expect(target("not a url")).toBeNull();
            expect(target("ftp://example.org/cat.png")).toBeNull();
        });
    });
});

describe("parseTimeOffset", () => {
    it.each([
        ["90", 90],
        ["90s", 90],
        ["1m30s", 90],
        ["1h2m3s", 3723],
        ["2h", 7200],
    ])("reads %s", (value, seconds) => {
        expect(parseTimeOffset(value)).toBe(seconds);
    });

    it.each([null, "", "abc", "1x"])("ignores %s", (value) => {
        expect(parseTimeOffset(value)).toBeUndefined();
    });
});

describe("server previews", () => {
    it("treats a preview of just an image as the image itself", () => {
        const preview = serverPreview({
            "og:description": null,
            "og:image": "mxc://example.org/abc",
            "og:image:type": "image/jpeg",
        });
        expect(previewImageOnly(preview)).toBe("mxc://example.org/abc");
    });

    it("does not treat a page preview as an image", () => {
        const preview = serverPreview({
            "og:title": "A page",
            "og:image": "mxc://example.org/abc",
            "og:image:type": "image/png",
        });
        expect(previewImageOnly(preview)).toBeUndefined();
        expect(hasPreviewText(preview)).toBe(true);
    });

    it("finds no text in an empty preview", () => {
        expect(hasPreviewText(serverPreview({ "og:title": " ", "og:url": "https://example.org" }))).toBe(false);
        expect(hasPreviewText(null)).toBe(false);
    });
});
