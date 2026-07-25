import { useEffect, useState } from "react";
import { type MatrixClient, type Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { getProfileRoomLink, PROFILE_ROOM_ID_PATTERN } from "./social-actions";
import { ROOM_BANNER_EVENT_TYPE } from "./room-classifier";

/**
 * MSC4427 profile banner - an extended-profile field (MSC4133) alongside displayname/avatar_url,
 * set/read via MatrixClient's own setExtendedProfileProperty/getExtendedProfileProperty. Value is
 * a bare mxc:// string (no info/dimensions object, unlike MSC4221's own room banner). Unstable
 * prefix per the MSC's own "Unstable prefix" section - switch to the stable `m.banner_url` key
 * only once MSC4427 is actually accepted into the spec.
 */
export const PROFILE_BANNER_KEY = "chat.commet.profile_banner";

/**
 * Resolves a user's banner as an http(s) URL ready for an <img src>, preferring their own MSC4427
 * profile banner (set directly on their own /profile data - see UserProfileSettings.tsx for where
 * a user sets this for themselves) over this hook's older fallback: a banner on their linked
 * MSC4501 profile room, mirroring RoomSummaryCardView's own RoomBanner logic for an arbitrary user
 * rather than a room already being viewed. Most viewers of a UserInfo panel won't have joined that
 * user's profile room, so that fallback peeks (same approach resolveProfileRoom uses for
 * non-members) when there's no already-joined/cached Room to read state from directly. Returns
 * null while resolving, once confirmed unset, or if the room turns out private/unpeekable.
 */
export function useUserBanner(client: MatrixClient, userId: string): string | null {
    const [profileBannerMxc, setProfileBannerMxc] = useState<string | null>(null);
    const [roomBannerUrl, setRoomBannerUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setProfileBannerMxc(null);

        void (async (): Promise<void> => {
            try {
                if (!(await client.doesServerSupportExtendedProfiles())) return;
                const value = await client.getExtendedProfileProperty(userId, PROFILE_BANNER_KEY);
                if (!cancelled && typeof value === "string" && value) setProfileBannerMxc(value);
            } catch {
                // No banner set (M_NOT_FOUND), server doesn't support extended profiles, or some
                // other fetch failure - the profile-room fallback below covers all of these.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [client, userId]);

    useEffect(() => {
        let cancelled = false;
        setRoomBannerUrl(null);

        const readFromRoom = (room: Room): string | null => {
            const mxc = room.currentState.getStateEvents(ROOM_BANNER_EVENT_TYPE as any, "")?.getContent()?.url;
            return mxc ? client.mxcUrlToHttp(mxc) : null;
        };

        let subscribedRoom: Room | undefined;
        const onUpdate = (): void => {
            if (!cancelled && subscribedRoom) setRoomBannerUrl(readFromRoom(subscribedRoom));
        };

        void getProfileRoomLink(client, userId).then(async (profileRoomId) => {
            if (cancelled || !profileRoomId || !PROFILE_ROOM_ID_PATTERN.test(profileRoomId)) return;

            let room = client.getRoom(profileRoomId) ?? undefined;
            if (!room) {
                try {
                    await client.peekInRoom(profileRoomId);
                } catch {
                    return; // not public/peekable - no banner available, same graceful no-op used elsewhere
                }
                if (cancelled) return;
                room = client.getRoom(profileRoomId) ?? undefined;
            }
            if (cancelled || !room) return;

            subscribedRoom = room;
            room.on(RoomStateEvent.Update, onUpdate);
            setRoomBannerUrl(readFromRoom(room));
        });

        return () => {
            cancelled = true;
            subscribedRoom?.off(RoomStateEvent.Update, onUpdate);
        };
    }, [client, userId]);

    // MSC4427 profile banner takes priority over the MSC4501 profile-room fallback.
    if (profileBannerMxc) return client.mxcUrlToHttp(profileBannerMxc);
    return roomBannerUrl;
}
