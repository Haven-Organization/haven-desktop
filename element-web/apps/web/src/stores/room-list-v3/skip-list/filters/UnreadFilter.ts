/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Room } from "matrix-js-sdk/src/matrix";
import { type Filter, FilterEnum } from ".";
import { RoomNotificationStateStore } from "../../../notifications/RoomNotificationStateStore";
import { getMarkedUnreadState } from "../../../../utils/notifications";

export class UnreadFilter implements Filter {
    /**
     * Haven: `getCurrentRoomId` is read fresh on every `matches()` call (not just once), and lets
     * the room you have open keep matching this filter even after opening it marks it read -
     * otherwise it would vanish out from under you the instant its read receipt lands. The store
     * (see RoomListStoreV3's own Action.ViewRoom handling) re-evaluates both the previously- and
     * newly-viewed room whenever the selection changes, so the old room properly drops out the
     * moment you actually switch away, if it's still read by then.
     */
    public constructor(private readonly getCurrentRoomId: () => string | undefined) {}

    public matches(room: Room): boolean {
        if (room.roomId === this.getCurrentRoomId()) return true;

        // Haven: was hasUnreadCount, which only matches a room with an actual notification-count
        // badge (mentions/highlights) - missing the plain "white dot" activity-only unread state
        // every other room-list bold/dot indicator already treats as unread (see e.g.
        // RoomListItemViewModel's own isBold). See
        // https://github.com/element-hq/element-web/issues/32567.
        return (
            RoomNotificationStateStore.instance.getRoomState(room).hasAnyNotificationOrActivity ||
            !!getMarkedUnreadState(room)
        );
    }

    public get key(): FilterEnum.UnreadFilter {
        return FilterEnum.UnreadFilter;
    }
}
