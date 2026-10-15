/*
 * Haven: the rooms and people Spotlight searches locally, moved out of SpotlightDialog.tsx
 * unchanged so Social's Search section (usePeopleSearch) finds people the same way.
 */

import { type MatrixClient, type Room, type RoomMember } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import DMRoomMap from "./DMRoomMap";
import { isLocalRoom } from "./localRoom/isLocalRoom";

/** Joined and invited rooms, excluding local (not yet created) rooms. */
export const findVisibleRooms = (cli: MatrixClient, msc3946ProcessDynamicPredecessor: boolean): Room[] => {
    return cli.getVisibleRooms(msc3946ProcessDynamicPredecessor).filter((room) => {
        // Do not show local rooms
        if (isLocalRoom(room)) return false;

        // TODO we may want to put invites in their own list
        return room.getMyMembership() === KnownMembership.Join || room.getMyMembership() == KnownMembership.Invite;
    });
};

/** Every joined member of `visibleRooms` except yourself, once each; DM rooms skipped unless `filterDMs` is false. */
export const findVisibleRoomMembers = (visibleRooms: Room[], cli: MatrixClient, filterDMs = true): RoomMember[] => {
    return Object.values(
        visibleRooms
            .filter((room) => !filterDMs || !DMRoomMap.shared().getUserIdForRoomId(room.roomId))
            .reduce(
                (members, room) => {
                    for (const member of room.getJoinedMembers()) {
                        members[member.userId] = member;
                    }
                    return members;
                },
                {} as Record<string, RoomMember>,
            ),
    ).filter((it) => it.userId !== cli.getUserId());
};
