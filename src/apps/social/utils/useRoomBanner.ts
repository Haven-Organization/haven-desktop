import { useEffect, useState } from "react";
import { type MatrixClient, type Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { ROOM_BANNER_EVENT_TYPE } from "./room-classifier";
import { LocalRoom } from "../../../../element-web/apps/web/src/models/LocalRoom";

/**
 * Resolves a room's MSC4221 banner, if any, as an http(s) URL ready for an <img src>. Shared by
 * RoomHeader.tsx (which used to keep its own private copy of this) and SpaceRoomView.tsx's own
 * space-homepage banner, so both stay in sync on exactly what counts as "this room's banner".
 */
export function useRoomBanner(client: MatrixClient, room: Room | LocalRoom): string | null {
    const readBannerMxc = (): string | null =>
        room instanceof LocalRoom
            ? null
            : (room.currentState.getStateEvents(ROOM_BANNER_EVENT_TYPE as any, "")?.getContent()?.url ?? null);
    const [bannerMxc, setBannerMxc] = useState<string | null>(readBannerMxc);

    useEffect(() => {
        setBannerMxc(readBannerMxc());
        if (room instanceof LocalRoom) return;
        const onUpdate = (): void => setBannerMxc(readBannerMxc());
        room.on(RoomStateEvent.Update, onUpdate);
        return () => {
            room.off(RoomStateEvent.Update, onUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    return bannerMxc ? client.mxcUrlToHttp(bannerMxc) : null;
}
