/*
 * Social Overlay — SocialProfilePreview
 *
 * Shown for a user's linked MSC4501 profile room when you're not a member and it couldn't be
 * (fully) peeked — see resolveProfileRoom in social-actions.ts. Mirrors SocialRoomView/
 * SocialUserProfileView's own header layout, populated from the room's public summary (MSC3266)
 * instead of a real Room object, since one doesn't exist yet. No banner (not part of the summary
 * schema) and no posts (nothing to peek) — just enough to decide whether to follow or knock.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { type MatrixClient, KnownMembership } from "matrix-js-sdk/src/matrix";

import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import { useLiveUserProfile } from "../utils/liveUserProfile";
import { useRoomMembership } from "../utils/useRoomMembership";
import { followRoom } from "../utils/social-actions";
import { isGroupRoomType } from "../utils/room-classifier";
import { linkifyAndSanitizeHtml } from "../../../../element-web/apps/web/src/HtmlUtils";

interface Props {
    client: MatrixClient;
    userId: string;
    roomId: string;
    joinRule: "public" | "knock";
    name?: string;
    avatarUrl?: string;
    topic?: string;
    /** Read from the room summary's own room_type (MSC3827) rather than getRoomType()'s Room-based
     *  read, since a preview by definition has no joined/peeked Room yet - see resolveProfileRoom
     *  in social-actions.ts. Selects Join/Leave-style wording over Follow/Unfollow's. */
    roomType?: string;
    onBack?: () => void;
    /** Called once a public room's Follow button successfully joins it, so the caller can switch
     *  to the real SocialRoomView instead of staying on this summary-only preview. */
    onFollowed: (roomId: string) => void;
}

export function SocialProfilePreview({
    client,
    userId,
    roomId,
    joinRule,
    name,
    avatarUrl,
    topic,
    roomType,
    onBack,
    onFollowed,
}: Props): JSX.Element {
    const isGroup = isGroupRoomType(roomType);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Briefly true right after a successful knockRoom() call, until membership (reactive, below)
    // catches up and takes over the button's own label - covers "clicking Send Follow Request gave
    // no visible feedback that anything happened".
    const [justSentKnock, setJustSentKnock] = useState(false);
    // Tracks the real room membership (knock/invite/leave), not just "did handleKnock run this
    // session" - a plain local flag would forget an already-pending knock from a previous visit,
    // and wouldn't notice an invite arriving while this page is already open (see
    // useRoomMembership.ts).
    const membership = useRoomMembership(client, roomId);

    // The room summary doesn't carry the sender's own live profile — fall back to it only for
    // whatever the summary itself left blank (an unnamed room, say), same spirit as
    // SocialUserProfileView's own placeholder.
    const liveProfile = useLiveUserProfile(client, name && avatarUrl ? undefined : userId);
    const displayName = name || liveProfile?.displayName || userId;
    const avatarHttpUrl = avatarUrl
        ? client.mxcUrlToHttp(avatarUrl, 104, 104, "crop")
        : liveProfile?.avatarUrl
          ? client.mxcUrlToHttp(liveProfile.avatarUrl, 104, 104, "crop")
          : null;

    const handleFollow = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await followRoom(client, roomId);
            onFollowed(roomId);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to follow");
            setBusy(false);
        }
    }, [client, roomId, onFollowed]);

    const handleKnock = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await client.knockRoom(roomId);
            // membership flips to "knock" itself once the resulting Room appears in the client's
            // store (see useRoomMembership.ts) - justSentKnock only covers the brief remaining gap
            // until that catches up and takes over the label.
            setJustSentKnock(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to request to follow");
        } finally {
            setBusy(false);
        }
    }, [client, roomId]);

    const handleCancelKnock = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await client.leave(roomId);
            setJustSentKnock(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to cancel follow request");
        } finally {
            setBusy(false);
        }
    }, [client, roomId]);

    const handleAcceptInvite = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await client.joinRoom(roomId);
            onFollowed(roomId);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to accept follow request");
            setBusy(false);
        }
    }, [client, roomId, onFollowed]);

    // Auto-accept an invite that arrives while viewing this knock-access page (the profile/group
    // owner approving the follow/join request sent above) - the same behavior implemented for
    // clicking a repost card pointing at a knock-access room (see KnockToFollowDialog in
    // SocialEventTile.tsx) and for SocialRoomView's own peeked-room equivalent of this page.
    // Whatever specific post the user originally clicked through a matrix.to link for (if any) is
    // picked up automatically too, once onFollowed below switches the caller over to a real
    // SocialRoomView for this room - that component consumes the same pending-focus-event hand-off
    // this page never needed to know about itself. autoAcceptedRef guards against double-accepting
    // if this effect re-fires for an unrelated reason while still invited.
    const autoAcceptedRef = useRef(false);
    useEffect(() => {
        if (membership !== KnownMembership.Invite || autoAcceptedRef.current) return;
        autoAcceptedRef.current = true;
        void (async () => {
            setBusy(true);
            setError(null);
            try {
                await client.joinRoom(roomId);
                onFollowed(roomId);
            } catch (err: unknown) {
                autoAcceptedRef.current = false; // let a retry (e.g. a fresh invite event) try again
                setError(err instanceof Error ? err.message : "Failed to accept follow request");
                setBusy(false);
            }
        })();
    }, [client, roomId, membership, onFollowed]);

    return (
        <div className="social_RoomView">
            {onBack && (
                <div className="social_RoomView_backBar">
                    <button className="social_BackBtn" onClick={onBack}>
                        ← Back
                    </button>
                </div>
            )}

            <div className="social_RoomView_banner" aria-hidden />

            <div className="social_RoomView_header">
                <div className="social_RoomView_avatarWrap">
                    <BaseAvatar name={displayName} idName={userId} url={avatarHttpUrl ?? undefined} size="104px" />
                </div>
                <div className="social_RoomView_meta">
                    <div className="social_RoomView_info">
                        <h2>{displayName}</h2>
                        {topic && (
                            <p
                                className="social_RoomView_topic"
                                dangerouslySetInnerHTML={{ __html: linkifyAndSanitizeHtml(topic) }}
                            />
                        )}
                    </div>
                    <div className="social_RoomView_actions">
                        {/* All membership-relationship buttons here share the same solid shape
                            (see AccessibleButton kinds) - "primary" for anything that starts/
                            accepts a relationship, "danger" for anything that undoes/cancels one -
                            rather than mixing in the plain-text "secondary" link style, which used
                            to make the pending-knock button look like a different kind of control. */}
                        {joinRule === "public" ? (
                            <AccessibleButton kind="primary" element="button" disabled={busy} onClick={handleFollow}>
                                {busy ? "Sending…" : isGroup ? "Join" : "Follow"}
                            </AccessibleButton>
                        ) : membership === KnownMembership.Invite ? (
                            // Usually beaten to it by the auto-accept effect above - this is its
                            // manual fallback if that join itself failed and needs a retry.
                            <AccessibleButton
                                kind="primary"
                                element="button"
                                disabled={busy}
                                onClick={handleAcceptInvite}
                            >
                                {busy ? "Sending…" : isGroup ? "Accept Invite" : "Accept Follow Request"}
                            </AccessibleButton>
                        ) : membership === KnownMembership.Knock ? (
                            <AccessibleButton
                                kind="danger"
                                element="button"
                                disabled={busy}
                                onClick={handleCancelKnock}
                            >
                                {busy ? "Sending…" : isGroup ? "Cancel Join Request" : "Cancel Follow Request"}
                            </AccessibleButton>
                        ) : (
                            <AccessibleButton kind="primary" element="button" disabled={busy} onClick={handleKnock}>
                                {/* justSentKnock covers the brief gap between knockRoom() resolving
                                    and membership (reactive) catching up to the Knock case above -
                                    see justSentKnock's own doc. */}
                                {busy
                                    ? "Sending…"
                                    : justSentKnock
                                      ? isGroup
                                          ? "Join Request Sent"
                                          : "Follow Request Sent"
                                      : isGroup
                                        ? "Request to Join"
                                        : "Send Follow Request"}
                            </AccessibleButton>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="social_ContentEmpty">
                    <p className="social_Error">{error}</p>
                </div>
            )}
        </div>
    );
}
