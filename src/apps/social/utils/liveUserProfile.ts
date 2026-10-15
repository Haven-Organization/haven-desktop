/*
 * Social Overlay — liveUserProfile
 *
 * Live-resolves a user's current avatar/displayname via their global Matrix profile
 * (client.getProfileInfo), rather than trusting a repost's embedded snapshot or requiring room
 * membership — see project memory for why avatar has no embedded fallback at all (visual
 * impersonation + tracking-pixel risk), while displayname prefers live but still has one.
 * Module-level cache shared across every caller, so rendering many reposts/profile views for the
 * same sender only fetches that profile once.
 */

import { useEffect, useState } from "react";
import { type MatrixClient, User } from "matrix-js-sdk/src/matrix";

/**
 * MSC4503 external handle: a linked identity on some other (usually non-Matrix) protocol, e.g. a
 * Fediverse/ActivityPub handle. `protocol` describes which protocol this is - its own
 * `avatar_url`/`displayname` identify the *protocol* (a logo + name like "Fediverse"), not the
 * user - see the RightPanel/profile-room rendering for how this gets shown.
 */
export interface ExternalHandleProtocol {
    id: string;
    displayname?: string;
    avatar_url?: string;
}

export interface ExternalHandle {
    handle: string;
    protocol: ExternalHandleProtocol;
    url?: string;
}

export interface LiveUserProfile {
    avatarUrl?: string;
    displayName?: string;
    externalHandle?: ExternalHandle;
}

// The stable key per MSC4503; checked first, falling back to the MSC's own unstable-prefixed form
// for homeservers/bridges that haven't caught up to the stable identifier yet. Exported so callers
// reading a *post's own* external_handle (SocialEventTile.tsx) rather than a user's profile info can
// still tell it apart from other content fields worth stripping - see that file's own use.
export const EXTERNAL_HANDLE_STABLE_KEY = "m.external_handle";
export const EXTERNAL_HANDLE_UNSTABLE_KEY = "org.matrix.msc4503.external_handle";

/** Not profile-specific despite this module's name - works on any object that might carry either
 *  external_handle key, so SocialEventTile.tsx reuses it directly on a post's own event content
 *  (org.matrix.msc4503.social's rendering of the *post's* linked identity, as opposed to this
 *  module's own fetchUserProfile, which reads a *user's* global profile info). */
export function extractExternalHandle(info: Record<string, unknown>): ExternalHandle | undefined {
    const raw = (info[EXTERNAL_HANDLE_STABLE_KEY] ?? info[EXTERNAL_HANDLE_UNSTABLE_KEY]) as
        | Partial<ExternalHandle>
        | undefined;
    if (!raw || typeof raw.handle !== "string") return undefined;
    const protocol = raw.protocol as Partial<ExternalHandleProtocol> | undefined;
    if (!protocol || typeof protocol.id !== "string") return undefined;

    return {
        handle: raw.handle,
        protocol: {
            id: protocol.id,
            displayname: typeof protocol.displayname === "string" ? protocol.displayname : undefined,
            avatar_url: typeof protocol.avatar_url === "string" ? protocol.avatar_url : undefined,
        },
        url: typeof raw.url === "string" ? raw.url : undefined,
    };
}

const profileCache = new Map<string, Promise<LiveUserProfile>>();

export function fetchUserProfile(client: MatrixClient, userId: string): Promise<LiveUserProfile> {
    let cached = profileCache.get(userId);
    if (!cached) {
        cached = client.getProfileInfo(userId).then(
            (info) => ({
                avatarUrl: info.avatar_url,
                displayName: info.displayname,
                externalHandle: extractExternalHandle(info as Record<string, unknown>),
            }),
            () => ({}), // deactivated account, unreachable homeserver, etc. — fall back silently
        );
        profileCache.set(userId, cached);
    }
    return cached;
}

export function useLiveUserProfile(client: MatrixClient, userId: string | undefined): LiveUserProfile | null {
    const [profile, setProfile] = useState<LiveUserProfile | null>(null);

    useEffect(() => {
        if (!userId) {
            setProfile(null);
            return;
        }
        let cancelled = false;
        fetchUserProfile(client, userId).then((p) => {
            if (!cancelled) setProfile(p);
        });
        return () => {
            cancelled = true;
        };
    }, [client, userId]);

    return profile;
}

/**
 * A copy of `user` with its missing display name and avatar filled in from `profile`, or `user`
 * itself when there is nothing to fill. A bare User (e.g. the one Linkify.ts builds when a plain
 * user link is clicked) only carries a profile when the client shares a room with that user, so
 * without this the user info panel shows just the MXID and a letter avatar. Copies rather than
 * mutating because `user` may be the client's own shared User object.
 */
export function fillUserFromProfile(user: User, profile: LiveUserProfile | null): User {
    if (!profile) return user;
    const hasName = !!user.rawDisplayName && user.rawDisplayName !== user.userId;
    const displayName = hasName ? undefined : profile.displayName;
    const avatarUrl = user.avatarUrl ? undefined : profile.avatarUrl;
    if (!displayName && !avatarUrl) return user;

    const filled = new User(user.userId);
    filled.presence = user.presence;
    filled.presenceStatusMsg = user.presenceStatusMsg;
    filled.lastActiveAgo = user.lastActiveAgo;
    filled.lastPresenceTs = user.lastPresenceTs;
    filled.currentlyActive = user.currentlyActive;
    filled.events = user.events;
    filled.setDisplayName(displayName ?? user.displayName ?? user.userId);
    filled.setRawDisplayName(displayName ?? user.rawDisplayName);
    filled.setAvatarUrl(avatarUrl ?? user.avatarUrl);
    return filled;
}
