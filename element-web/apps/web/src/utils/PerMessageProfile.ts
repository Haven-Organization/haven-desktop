/*
 * Haven: MSC4144 per-message profiles.
 *
 * Shared by the main room timeline (EventTile) and Social's own post tiles (SocialEventTile) -
 * both read the same wire format, so the resolution rules live here once instead of twice.
 *
 * Uses the "com.beeper.per_message_profile" unstable prefix rather than the MSC's eventual stable
 * "m.per_message_profile" name - the MSC hasn't landed, and every real implementation (Sable,
 * beeper's own bridges) actually sends the unstable key today, so that's what needs reading.
 */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

export const PER_MESSAGE_PROFILE_KEY = "com.beeper.per_message_profile";

export interface PerMessageProfile {
    /** Required by the MSC - an opaque per-account identifier for this pseudo-sender. Never used
     *  as a display value; only as a fallback-avatar colour/identity seed (see
     *  resolvePerMessageAvatarUrl's caller) and, in principle, for grouping consecutive messages
     *  from the same persona - grouping isn't implemented here since nothing asked for it. */
    id: string;
    displayname?: string;
    avatar_url?: string;
    // avatar_file (encrypted per-message avatars) is intentionally not handled - falls back to
    // the sender's own room-member avatar exactly as if no avatar were set at all, since
    // decrypting a standalone avatar blob isn't wired up anywhere else in the app either.
    has_fallback?: boolean;
}

/**
 * Reads and validates a per-message profile out of a raw event content object, if any. Per
 * MSC4144, `id` is the only required field - a profile missing it isn't valid and is treated as
 * absent. Exists separately from {@link getPerMessageProfile} for callers (e.g. Social's embedded
 * repost/quote cards) that only have a content object to work with, not a live MatrixEvent.
 */
export function getPerMessageProfileFromContent(
    content: Record<string, unknown> | undefined,
): PerMessageProfile | undefined {
    const raw = content?.[PER_MESSAGE_PROFILE_KEY] as { id?: unknown } | undefined;
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || raw.id.length === 0) {
        return undefined;
    }
    return raw as PerMessageProfile;
}

/**
 * Reads and validates a message event's per-message profile, if any. Per MSC4144, `id` is the
 * only required field - a profile missing it isn't valid and is treated as absent.
 */
export function getPerMessageProfile(event: MatrixEvent): PerMessageProfile | undefined {
    return getPerMessageProfileFromContent(event.getContent());
}

/**
 * Effective displayname per MSC4144: omitted, null, or empty falls back to the sender's own name
 * (a per-message profile can't clear the name entirely - the spec only supports clearing the
 * avatar, not the name).
 */
export function resolvePerMessageDisplayName(profile: PerMessageProfile | undefined): string | undefined {
    return profile?.displayname || undefined;
}

/**
 * Effective avatar mxc URL per MSC4144. Returns:
 *  - a real "mxc://..." string to use as the override avatar,
 *  - `null` if the profile explicitly clears the avatar (empty `avatar_url`) - callers should
 *    render a generated fallback avatar instead of the sender's own,
 *  - `undefined` if there's no override at all (omitted/null/non-mxc) - callers should fall back
 *    to the sender's own avatar exactly as if this profile didn't exist.
 */
export function resolvePerMessageAvatarUrl(profile: PerMessageProfile | undefined): string | null | undefined {
    if (!profile) return undefined;
    if (profile.avatar_url === "") return null;
    if (typeof profile.avatar_url === "string" && profile.avatar_url.startsWith("mxc://")) {
        return profile.avatar_url;
    }
    return undefined;
}
