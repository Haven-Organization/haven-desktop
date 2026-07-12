import { useEffect, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { useDispatcher } from "../../../../element-web/apps/web/src/hooks/useDispatcher";
import { getProfileRoomLink, PROFILE_ROOM_LINK_CHANGED } from "./social-actions";

/** The room id the user's account currently links as their MSC4501 profile room (`org.matrix.
 *  msc4501.social.profile_room_id`) — `undefined` while the initial fetch is in flight, `null` once
 *  confirmed unset. Re-fetches whenever setProfileRoomLink/clearProfileRoomLink run anywhere in
 *  the app (see PROFILE_ROOM_LINK_CHANGED), including from the separate React root Room Settings
 *  renders into. */
export function useProfileRoomLink(client: MatrixClient, myUserId: string): string | null | undefined {
    const [linkedRoomId, setLinkedRoomId] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        void getProfileRoomLink(client, myUserId).then((id) => {
            if (!cancelled) setLinkedRoomId(id);
        });
        return () => {
            cancelled = true;
        };
    }, [client, myUserId]);

    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action === PROFILE_ROOM_LINK_CHANGED) {
            void getProfileRoomLink(client, myUserId).then(setLinkedRoomId);
        }
    });

    return linkedRoomId;
}
