/*
 * Haven: whether this account's own homeserver honours the `animated=true` thumbnail query
 * param (MSC2705) - when it does, a genuinely-animated pack image/sticker can be requested at a
 * small, properly-sized thumbnail (crisp) rather than falling back to its full original (soft
 * once CSS-scaled down 10-20x into a tiny grid cell - see HavenEmojiPicker.tsx's own imageUrl
 * doc for why that fallback exists at all). Most homeservers still don't support it (confirmed
 * live 2026-09-04: glowers.club's own media repo silently ignores the param and returns the same
 * static single-frame PNG either way), so this is a real, per-server capability check - not
 * something safe to assume - with the untested/unsupported default matching today's existing
 * (correct, if blurry) full-original behavior exactly.
 *
 * One check ever needed per homeserver (thumbnailing always happens on OUR OWN media repo, at
 * `client.baseUrl`, regardless of which server a pack image's own mxc:// origin is), unlike
 * PackImageAnimationCache's own per-image check - so this is keyed by baseUrl, not by mxc.
 */

import { useEffect, useState } from "react";
import { getHttpUriForMxc } from "matrix-js-sdk/src/content-repo";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

const STORAGE_KEY = "mx_haven_animated_thumbnail_support_cache";

/** A real, animated-capable thumbnail response comes back as one of these - the static fallback
 *  every homeserver we've seen ignore the param with returns image/png or image/jpeg instead. */
const ANIMATED_CONTENT_TYPES = ["image/gif", "image/webp"];

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache.entries()]));
    } catch {
        // localStorage can throw (quota, private browsing) - losing the cache just means paying
        // the check again next session, not a functional problem.
    }
}

/** The cached, real answer for this homeserver, if this client has ever actually checked it
 *  before - undefined if it hasn't (yet). */
export function getCachedAnimatedThumbnailSupport(baseUrl: string): boolean | undefined {
    return cache.get(baseUrl);
}

/** Builds the HTTP URL for a small animated thumbnail of `mxcUrl`, sized for `size` (a square, in
 *  CSS px - scaled by devicePixelRatio same as Media.ts's own thumbnail helpers). Only meaningful
 *  to actually use once getCachedAnimatedThumbnailSupport(client.baseUrl) is confirmed true - the
 *  homeserver is free to silently ignore the `animated` param and return a static single frame
 *  instead, same as this same URL shape is used to detect in ensureAnimatedThumbnailSupportChecked
 *  below. */
export function getAnimatedThumbnailUrl(mxcUrl: string, client: MatrixClient, size: number): string | undefined {
    const dim = Math.floor(size * window.devicePixelRatio);
    const url = getHttpUriForMxc(client.baseUrl, mxcUrl, dim, dim, "crop", false, true, undefined, true);
    return url || undefined;
}

/** Kicks off a one-time, real check of `client.baseUrl`'s own animated-thumbnail support if one
 *  isn't already cached or in flight for it - a no-op otherwise. `sampleMxcUrl` should be an mxc
 *  already known to be genuinely animated (see PackImageAnimationCache's own getCachedPackImageAnimated)
 *  - the check works by asking for its own animated thumbnail and inspecting what actually comes
 *  back. Fire-and-forget; call getCachedAnimatedThumbnailSupport (after a re-render via
 *  useAnimatedThumbnailSupportVersion) to read the result once it's ready. */
export function ensureAnimatedThumbnailSupportChecked(sampleMxcUrl: string, client: MatrixClient): void {
    const baseUrl = client.baseUrl;
    if (cache.has(baseUrl) || inFlight.has(baseUrl)) return;
    const probeUrl = getAnimatedThumbnailUrl(sampleMxcUrl, client, 64);
    if (!probeUrl) return;
    inFlight.add(baseUrl);
    void (async (): Promise<void> => {
        try {
            const res = await fetch(probeUrl);
            if (!res.ok) return;
            const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
            const supported = !!contentType && ANIMATED_CONTENT_TYPES.includes(contentType);
            cache.set(baseUrl, supported);
            persist();
            listeners.forEach((listener) => listener());
        } catch {
            // Network hiccup etc. - leave uncached, retried harmlessly next time an animated
            // image is encountered.
        } finally {
            inFlight.delete(baseUrl);
        }
    })();
}

/** Re-renders the caller whenever a pending check resolves, so a memo reading
 *  getCachedAnimatedThumbnailSupport can pick up the fresh answer. */
export function useAnimatedThumbnailSupportVersion(): number {
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
