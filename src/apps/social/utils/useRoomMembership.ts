import { useEffect, useState } from "react";
import { type MatrixClient, type Room, type Membership, ClientEvent, RoomEvent } from "matrix-js-sdk/src/matrix";

import { shouldIgnoreStaleMembership } from "./pendingRoomLeave";

/**
 * Live-tracks the viewer's own membership in a room that may not exist in the client's store yet
 * (e.g. before knocking a room you've never interacted with) - null until a Room object appears
 * for this id (ClientEvent.Room, e.g. right after knockRoom succeeds, or an invite arriving over
 * sync while already viewing), then tracks that Room's own membership going forward
 * (RoomEvent.MyMembership) so e.g. an invite arriving while a knock is pending is reflected without
 * needing to leave and re-open the page.
 */
export function useRoomMembership(client: MatrixClient, roomId: string): Membership | null {
    const [membership, setMembership] = useState<Membership | null>(
        () => client.getRoom(roomId)?.getMyMembership() ?? null,
    );

    useEffect(() => {
        setMembership(client.getRoom(roomId)?.getMyMembership() ?? null);

        const onMyMembership = (room: Room, newMembership: Membership): void => {
            if (room.roomId !== roomId) return;
            // See pendingRoomLeave.ts - a stale, already-in-flight sync response can briefly revert
            // an optimistically-applied "leave" back to the pre-leave membership; ignore that one
            // contradicting update rather than trust it.
            if (shouldIgnoreStaleMembership(roomId, newMembership)) return;
            setMembership(newMembership);
        };
        const onRoom = (room: Room): void => {
            if (room.roomId === roomId) setMembership(room.getMyMembership());
        };

        client.on(RoomEvent.MyMembership, onMyMembership);
        client.on(ClientEvent.Room, onRoom);
        return () => {
            client.off(RoomEvent.MyMembership, onMyMembership);
            client.off(ClientEvent.Room, onRoom);
        };
    }, [client, roomId]);

    return membership;
}
