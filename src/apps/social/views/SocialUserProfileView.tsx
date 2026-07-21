/*
 * Social Overlay — SocialUserProfileView
 *
 * Shown instead of a real profile room when a clicked user's linked profile room can't be shown at
 * all — either they never linked a valid one (`reason: "no_profile"`, the default), it's
 * invite-only/private (`reason: "private"` — see resolveProfileRoom in social-actions.ts, which is
 * what decides between this and SocialProfilePreview for a public/knockable room), or resolving it
 * failed outright (`reason: "error"` — see handleViewUser in SocialHomeView.tsx). Mirrors
 * SocialRoomView's own profile page layout (banner/avatar/name) so it doesn't look like a dead
 * end, but uses the user's own live Matrix profile (avatar_url/displayname) instead of a room's,
 * and has no posts, no composer, no follow/edit actions.
 */

import React, { type JSX } from "react";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import Modal from "../../../../element-web/apps/web/src/Modal";
import ImageView from "../../../../element-web/apps/web/src/components/views/elements/ImageView";
import { useLiveUserProfile } from "../utils/liveUserProfile";

interface Props {
    userId: string;
    reason?: "no_profile" | "private" | "error";
    onBack?: () => void;
}

export function SocialUserProfileView({ userId, reason = "no_profile", onBack }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const profile = useLiveUserProfile(client, userId);
    const displayName = profile?.displayName || userId;
    const avatarHttpUrl = profile?.avatarUrl ? client.mxcUrlToHttp(profile.avatarUrl, 208, 208, "crop") : null;

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
                    <BaseAvatar
                        name={displayName}
                        idName={userId}
                        url={avatarHttpUrl ?? undefined}
                        size="104px"
                        onClick={
                            avatarHttpUrl
                                ? () =>
                                      Modal.createDialog(
                                          ImageView,
                                          { src: avatarHttpUrl, name: displayName },
                                          "mx_Dialog_lightbox",
                                          undefined,
                                          true,
                                      )
                                : undefined
                        }
                    />
                </div>
                <div className="social_RoomView_meta">
                    <div className="social_RoomView_info">
                        <h2>{displayName}</h2>
                        <p className="social_RoomView_topic">{userId}</p>
                    </div>
                </div>
            </div>

            <div className="social_ContentEmpty">
                <p>
                    {reason === "private"
                        ? `${displayName}'s profile is private.`
                        : reason === "error"
                          ? `Couldn't load ${displayName}'s profile right now. Try again later.`
                          : `${displayName} hasn't created a profile yet.`}
                </p>
            </div>
        </div>
    );
}
