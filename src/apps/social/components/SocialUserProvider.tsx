/*
 * Social Overlay - SocialUserProvider
 *
 * Stock UserProvider, but searching everyone the account shares a room with instead of only the
 * members of one room. The stock composer's "@" completions only offer the current room's members,
 * which suits a chat but not a Social post: the composer's room is a profile room (usually just
 * its followers), and a post can mention anyone. The current room's members still come first.
 */

import { type Room, type RoomMember } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import UserProvider from "../../../../element-web/apps/web/src/autocomplete/UserProvider";
import { type ICompletion, type ISelectionRange } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

export class SocialUserProvider extends UserProvider {
    public async getCompletions(
        rawQuery: string,
        selection: ISelectionRange,
        force = false,
        limit = -1,
    ): Promise<ICompletion[]> {
        // UserProvider only builds its own list when `users` is unset (and clears it again when this
        // room's state changes), so filling it first swaps in the wider list.
        if (!this.users) {
            this.users = collectKnownUsers(this.room);
            this.matcher.setObjects(this.users);
        }
        return super.getCompletions(rawQuery, selection, force, limit);
    }
}

/** One member per user across every joined room, `room`'s own members first, excluding yourself. */
export function collectKnownUsers(room: Room): RoomMember[] {
    const ownUserId = room.client.getUserId();
    const byId = new Map<string, RoomMember>();
    const add = (members: RoomMember[]): void => {
        for (const member of members) {
            if (member.userId !== ownUserId && !byId.has(member.userId)) byId.set(member.userId, member);
        }
    };
    add(room.getJoinedMembers());
    add(room.getMembersWithMembership(KnownMembership.Invite));
    for (const other of room.client.getRooms()) {
        if (other !== room && other.getMyMembership() === KnownMembership.Join) add(other.getJoinedMembers());
    }
    return [...byId.values()];
}
