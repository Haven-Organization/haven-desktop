import { useEffect, useState } from "react";
import { type MatrixClient, type Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { getProfileRoomLink, PROFILE_ROOM_ID_PATTERN } from "./social-actions";
import { ROOM_BANNER_EVENT_TYPE } from "./room-classifier";

/**
 * Resolves a user's linked MSC4501 profile room banner, if any, as an http(s) URL ready for an
 * <img src> - mirrors RoomSummaryCardView's own RoomBanner logic, but for an arbitrary user rather
 * than a room already being viewed. Most viewers of a UserInfo panel won't have joined that user's
 * profile room, so this falls back to a public peek (same approach resolveProfileRoom uses for
 * non-members) when there's no already-joined/cached Room to read state from directly. Returns
 * null while resolving, once confirmed unset, or if the room turns out private/unpeekable.
 */
export function useUserBanner(client: MatrixClient, userId: string): string | null {
    const [bannerUrl, setBannerUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setBannerUrl(null);

        const readFromRoom = (room: Room): string | null => {
            const mxc = room.currentState.getStateEvents(ROOM_BANNER_EVENT_TYPE as any, "")?.getContent()?.url;
            return mxc ? client.mxcUrlToHttp(mxc) : null;
        };

        let subscribedRoom: Room | undefined;
        const onUpdate = (): void => {
            if (!cancelled && subscribedRoom) setBannerUrl(readFromRoom(subscribedRoom));
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
            setBannerUrl(readFromRoom(room));
        });

        return () => {
            cancelled = true;
            subscribedRoom?.off(RoomStateEvent.Update, onUpdate);
        };
    }, [client, userId]);

    return bannerUrl;
}
