/*
 * Haven: MSC2545 pack images that predate the "org.matrix.msc4230.is_animated" flag (see
 * ImagePacks.ts's own ImagePackImageInfo doc) have no persisted, accurate answer to "is this image
 * actually animated" at all - only the unreliable mayBeAnimated(mimetype) guess, which flags every
 * ordinary static PNG/WEBP as animated too, same as a real one. Re-uploading an image fixes it
 * permanently, but a picker can't force that on an existing pack - confirmed live 2026-08-19
 * against a real reported-slow pack: 12 genuinely static PNGs, none carrying the flag (added
 * before it existed), all loading at full original resolution (~800x750px each, vs. a ~30px grid
 * cell) on every single picker open.
 *
 * This closes that gap without needing a re-upload: the first time a picker grid cell encounters
 * an unflagged image, it optimistically assumes static (loads the small thumbnail, not the full
 * original - correct for the common case per this codebase's own cross-client research, see
 * HavenEmojiPicker.tsx's own imageUrl doc) and kicks off a real, one-time check in the background
 * (fetch + blobIsAnimated's own byte-level parse). The verdict is cached in memory (this session)
 * and localStorage (future sessions), and a caller subscribes via useAnimatedImageCacheVersion to
 * re-render once a check resolves - in the rare case an image turns out to genuinely be animated,
 * its grid cell upgrades from a static thumbnail to the full original a moment after first
 * appearing, rather than either blocking every unflagged image up front or guessing wrong forever.
 */

import { useEffect, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { blobIsAnimated } from "./Image";
import { mediaFromMxc } from "../customisations/Media";

const STORAGE_KEY = "mx_haven_pack_image_animated_cache";
// A plain cap on entry count is enough to stop this growing unbounded for an account that's seen a
// huge number of distinct legacy (unflagged) images over time - correctness doesn't depend on
// which entries survive a cap, just that a dropped one re-checks (cheaply, once) if it's ever
// actually encountered in a picker again.
const STORAGE_LIMIT = 2000;

function loadPersisted(): Map<string, boolean> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return new Map();
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Map();
        return new Map(parsed);
    } catch {
        return new Map();
    }
}

const cache = loadPersisted();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function persist(): void {
    try {
        const entries = [...cache.entries()].slice(-STORAGE_LIMIT);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // localStorage can throw (quota, private browsing) - losing the cache just means paying
        // the check again next session, not a functional problem.
    }
}

/** The cached, real answer for this pack image, if this client has ever actually checked it
 *  before - undefined if it hasn't (yet). */
export function getCachedPackImageAnimated(mxcUrl: string): boolean | undefined {
    return cache.get(mxcUrl);
}

/** Kicks off a one-time, real check for this image if one isn't already cached or in flight - a
 *  no-op otherwise. Fire-and-forget; call getCachedPackImageAnimated (after a re-render via
 *  useAnimatedImageCacheVersion) to read the result once it's ready. */
export function ensurePackImageAnimatedChecked(mxcUrl: string, client: MatrixClient): void {
    if (cache.has(mxcUrl) || inFlight.has(mxcUrl)) return;
    const httpUrl = mediaFromMxc(mxcUrl, client).srcHttp;
    if (!httpUrl) return;
    inFlight.add(mxcUrl);
    void (async (): Promise<void> => {
        try {
            const res = await fetch(httpUrl);
            if (!res.ok) return;
            const blob = await res.blob();
            const animated = await blobIsAnimated(blob);
            if (animated === undefined) return; // couldn't determine - leave uncached, guess again next time too
            cache.set(mxcUrl, animated);
            persist();
            listeners.forEach((listener) => listener());
        } catch {
            // Network hiccup etc. - leave uncached, this image just falls back to guessing again
            // (harmlessly re-tried) next time it's encountered.
        } finally {
            inFlight.delete(mxcUrl);
        }
    })();
}

/** Re-renders the caller whenever any pending check resolves, so a memo reading
 *  getCachedPackImageAnimated can pick up the fresh answer. */
export function useAnimatedImageCacheVersion(): number {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const listener = (): void => setVersion((v) => v + 1);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);
    return version;
}
