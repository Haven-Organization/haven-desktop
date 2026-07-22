/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Room } from "matrix-js-sdk/src/matrix";
import { type Filter, FilterEnum } from ".";
import { RoomNotificationStateStore } from "../../../notifications/RoomNotificationStateStore";
import { getMarkedUnreadState } from "../../../../utils/notifications";
import SettingsStore from "../../../../settings/SettingsStore";

export class UnreadFilter implements Filter {
    /**
     * Haven: mirrors whatever `getCurrentRoomId()` last reported, so `matches()` can tell "the
     * selection just changed to this room" apart from "still looking at the same room as last
     * time" - see `matches()` itself for why that distinction matters.
     */
    private lastSeenCurrentRoomId: string | undefined;

    /**
     * Haven: whether `lastSeenCurrentRoomId` actually matched the plain (non-sticky) unread
     * criteria at the moment it became the selected room - see `matches()`.
     */
    private currentRoomWasUnreadOnSelect = false;

    /**
     * Haven: `getCurrentRoomId` is read fresh on every `matches()` call (not just once), so a room
     * that was genuinely unread when you opened it keeps matching this filter even after it's
     * since been marked read - otherwise it would vanish out from under you the instant its read
     * receipt lands. The store (see RoomListStoreV3's own Action.ViewRoom handling) re-evaluates
     * both the previously- and newly-viewed room whenever the selection changes, so the old room
     * properly drops out the moment you actually switch away, if it's still read by then.
     */
    public constructor(private readonly getCurrentRoomId: () => string | undefined) {}

    private isUnreadByCriteria(room: Room): boolean {
        const notificationState = RoomNotificationStateStore.instance.getRoomState(room);

        // Haven: stock only ever matched hasUnreadCount (a real notification-count badge -
        // mentions/highlights/all-messages-notify rooms like DMs), missing the plain "white dot"
        // activity-only unread state every other room-list bold/dot indicator already treats as
        // unread (see e.g. RoomListItemViewModel's own isBold) - see
        // https://github.com/element-hq/element-web/issues/32567. Gated behind a setting (off by
        // default, matching stock) rather than replacing hasUnreadCount outright, since not
        // everyone wants every merely-active room cluttering this filter - see
        // Haven.showAllUnreadRoomsInUnreadsFilter's own doc in Settings.tsx.
        return SettingsStore.getValue("Haven.showAllUnreadRoomsInUnreadsFilter")
            ? notificationState.hasAnyNotificationOrActivity || !!getMarkedUnreadState(room)
            : notificationState.hasUnreadCount || !!getMarkedUnreadState(room);
    }

    public matches(room: Room): boolean {
        const currentRoomId = this.getCurrentRoomId();

        if (currentRoomId === room.roomId) {
            // Haven: the selection changed since the last time we looked (or this is the very
            // first time we've seen it) - decide fresh, right now, whether this room actually
            // earns the "stay visible even after it's read" exemption below. Deciding this once,
            // at the moment of selection, rather than treating every currently-selected room as
            // automatically exempt, is what stops an already-read room from wrongly staying in
            // the Unreads list just because you happened to be sitting in it when you turned the
            // filter on - stock shows its own "Congrats! You don't have any unread messages" empty
            // state in that case, not the stale selection - confirmed live 2026-07-22.
            if (this.lastSeenCurrentRoomId !== currentRoomId) {
                this.lastSeenCurrentRoomId = currentRoomId;
                this.currentRoomWasUnreadOnSelect = this.isUnreadByCriteria(room);
            }
            if (this.currentRoomWasUnreadOnSelect) return true;
        }

        return this.isUnreadByCriteria(room);
    }

    public get key(): FilterEnum.UnreadFilter {
        return FilterEnum.UnreadFilter;
    }
}
