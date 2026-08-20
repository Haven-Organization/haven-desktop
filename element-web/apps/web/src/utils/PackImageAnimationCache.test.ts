/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    ensurePackImageAnimatedChecked,
    getCachedPackImageAnimated,
    useAnimatedImageCacheVersion,
} from "./PackImageAnimationCache";
import * as Image from "./Image";

// Haven: regression tests for a real bug - a legacy MSC2545 pack image (added before the
// "org.matrix.msc4230.is_animated" flag existed - see ImagePacks.ts's own ImagePackImageInfo doc)
// has no persisted, accurate answer to "is this actually animated", so HavenEmojiPicker.tsx used to
// fall back straight to the mimetype-only guess and load every one of them at full original
// resolution - confirmed live 2026-08-19 against a real reported-slow pack (12 static PNGs, none
// flagged, all loading ~800x750px into a ~30px grid cell on every open). This module is what
// closes that gap: a client-side, cached, one-time check per image, used instead of the guess.
describe("PackImageAnimationCache", () => {
    let mxcCounter = 0;
    /** A fresh, never-before-seen mxc:// URL per test, so tests don't pollute each other via the
     *  module's own singleton cache. */
    function freshMxcUrl(): string {
        mxcCounter += 1;
        return `mxc://example.org/pack-image-animation-cache-test-${mxcCounter}`;
    }

    const client = {
        mxcUrlToHttp: (mxc: string) => `https://example.org/_matrix/media/v3/download/${mxc.slice("mxc://".length)}`,
    } as unknown as MatrixClient;

    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("returns undefined for an image that's never been checked", () => {
        expect(getCachedPackImageAnimated(freshMxcUrl())).toBeUndefined();
    });

    it("caches a real static (false) answer after a check resolves, and notifies listeners", async () => {
        const url = freshMxcUrl();
        vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
        vi.spyOn(Image, "blobIsAnimated").mockResolvedValue(false);

        const { result } = renderHook(() => useAnimatedImageCacheVersion());
        const versionBefore = result.current;

        ensurePackImageAnimatedChecked(url, client);

        await waitFor(() => expect(result.current).toBeGreaterThan(versionBefore));
        expect(getCachedPackImageAnimated(url)).toBe(false);
        expect(JSON.parse(localStorage.getItem("mx_haven_pack_image_animated_cache")!)).toContainEqual([url, false]);
    });

    it("caches a real animated (true) answer after a check resolves", async () => {
        const url = freshMxcUrl();
        vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
        vi.spyOn(Image, "blobIsAnimated").mockResolvedValue(true);

        ensurePackImageAnimatedChecked(url, client);

        await waitFor(() => expect(getCachedPackImageAnimated(url)).toBe(true));
    });

    it("only fetches once for repeated calls on the same not-yet-resolved image", async () => {
        const url = freshMxcUrl();
        let resolveFetch: (value: Response) => void;
        const fetchPromise = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        });
        vi.mocked(fetch).mockReturnValue(fetchPromise);
        vi.spyOn(Image, "blobIsAnimated").mockResolvedValue(false);

        ensurePackImageAnimatedChecked(url, client);
        ensurePackImageAnimatedChecked(url, client);
        ensurePackImageAnimatedChecked(url, client);

        expect(fetch).toHaveBeenCalledTimes(1);
        resolveFetch!({ ok: true, blob: async () => new Blob() } as Response);
        await waitFor(() => expect(getCachedPackImageAnimated(url)).toBe(false));
    });

    it("does not fetch again once an image is already cached", async () => {
        const url = freshMxcUrl();
        vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
        vi.spyOn(Image, "blobIsAnimated").mockResolvedValue(false);

        ensurePackImageAnimatedChecked(url, client);
        await waitFor(() => expect(getCachedPackImageAnimated(url)).toBe(false));

        ensurePackImageAnimatedChecked(url, client);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("leaves the image uncached (to retry later) when the check can't determine an answer", async () => {
        const url = freshMxcUrl();
        vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
        vi.spyOn(Image, "blobIsAnimated").mockResolvedValue(undefined);

        ensurePackImageAnimatedChecked(url, client);
        await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));

        expect(getCachedPackImageAnimated(url)).toBeUndefined();
    });

    it("leaves the image uncached when the fetch itself fails", async () => {
        const url = freshMxcUrl();
        vi.mocked(fetch).mockRejectedValue(new Error("network error"));

        ensurePackImageAnimatedChecked(url, client);
        await new Promise((r) => setTimeout(r, 0));

        expect(getCachedPackImageAnimated(url)).toBeUndefined();
    });
});
