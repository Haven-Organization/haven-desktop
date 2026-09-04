/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    ensureAnimatedThumbnailSupportChecked,
    getAnimatedThumbnailUrl,
    getCachedAnimatedThumbnailSupport,
    useAnimatedThumbnailSupportVersion,
} from "./AnimatedThumbnailSupport";

// Haven: regression coverage for a real bug - a genuinely-animated MSC2545 pack image was always
// rendered at full original resolution in the emoji picker grid (see HavenEmojiPicker.tsx's own
// imageUrl doc), softened to the point of looking blurry once the browser downscaled it 10-20x
// into a ~30px cell. Confirmed live 2026-09-04 that most homeservers (including a real deployment
// tested against) silently ignore the `animated=true` thumbnail param and keep returning the same
// static single-frame fallback either way - this module is what tells the two cases apart, so a
// homeserver that *does* honour it can get a small, crisp, still-animated thumbnail instead.
describe("AnimatedThumbnailSupport", () => {
    let baseUrlCounter = 0;
    /** A fresh, never-before-seen baseUrl per test, so tests don't pollute each other via the
     *  module's own singleton cache. */
    function freshBaseUrl(): string {
        baseUrlCounter += 1;
        return `https://example${baseUrlCounter}.org`;
    }

    function makeClient(baseUrl: string): MatrixClient {
        return { baseUrl } as unknown as MatrixClient;
    }

    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("returns undefined for a homeserver that's never been checked", () => {
        expect(getCachedAnimatedThumbnailSupport(freshBaseUrl())).toBeUndefined();
    });

    it("builds an animated thumbnail URL scaled by devicePixelRatio", () => {
        const client = makeClient(freshBaseUrl());
        const url = getAnimatedThumbnailUrl("mxc://example.org/abc123", client, 64);

        expect(url).toContain("animated=true");
        expect(url).toContain("width=64");
        expect(url).toContain("height=64");
        expect(url).toContain("method=crop");
    });

    it("caches support=true when the server returns a real animated content-type", async () => {
        const baseUrl = freshBaseUrl();
        const client = makeClient(baseUrl);
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "image/gif" }),
        } as Response);

        const { result } = renderHook(() => useAnimatedThumbnailSupportVersion());
        const versionBefore = result.current;

        ensureAnimatedThumbnailSupportChecked("mxc://example.org/animated1", client);

        await waitFor(() => expect(result.current).toBeGreaterThan(versionBefore));
        expect(getCachedAnimatedThumbnailSupport(baseUrl)).toBe(true);
        expect(JSON.parse(localStorage.getItem("mx_haven_animated_thumbnail_support_cache")!)).toContainEqual([
            baseUrl,
            true,
        ]);
    });

    it("caches support=false when the server silently returns the static fallback format", async () => {
        const baseUrl = freshBaseUrl();
        const client = makeClient(baseUrl);
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
        } as Response);

        ensureAnimatedThumbnailSupportChecked("mxc://example.org/animated2", client);

        await waitFor(() => expect(getCachedAnimatedThumbnailSupport(baseUrl)).toBe(false));
    });

    it("only checks once per homeserver, even across many different sample images", async () => {
        const baseUrl = freshBaseUrl();
        const client = makeClient(baseUrl);
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
        } as Response);

        ensureAnimatedThumbnailSupportChecked("mxc://example.org/animated3", client);
        ensureAnimatedThumbnailSupportChecked("mxc://example.org/some-other-animated-image", client);

        await waitFor(() => expect(getCachedAnimatedThumbnailSupport(baseUrl)).toBe(false));
        expect(fetch).toHaveBeenCalledTimes(1);

        ensureAnimatedThumbnailSupportChecked("mxc://example.org/yet-another", client);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("leaves the homeserver uncached when the fetch itself fails", async () => {
        const baseUrl = freshBaseUrl();
        const client = makeClient(baseUrl);
        vi.mocked(fetch).mockRejectedValue(new Error("network error"));

        ensureAnimatedThumbnailSupportChecked("mxc://example.org/animated4", client);
        await new Promise((r) => setTimeout(r, 0));

        expect(getCachedAnimatedThumbnailSupport(baseUrl)).toBeUndefined();
    });
});
