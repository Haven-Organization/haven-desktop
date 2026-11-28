/*
 * Haven - MSC4591 formatted room names: an optional "m.formatted_name" object next to `name` in
 * m.room.name, with the same restricted HTML and rules as MSC4589 formatted display names (see
 * formattedDisplayName.ts, which does the checking and building), behind the same lab.
 *
 * Plain names for pending invites, so invite spam can't put imagery in front of the user, and for
 * any room shown under another name than its m.room.name (a name computed from its members, or an
 * override), since the formatted name only stands in for that exact name.
 */

import { useMemo } from "react";
import { EventType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { useRoomState } from "../../../../element-web/apps/web/src/hooks/useRoomState";
import { useMyRoomMembership } from "../../../../element-web/apps/web/src/hooks/useRoomMembers";
import { useFeatureEnabled } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { FORMATTED_NAMES_LAB, renderFormattedName } from "./formattedDisplayName";

export const FORMATTED_ROOM_NAME_STABLE_KEY = "m.formatted_name";
export const FORMATTED_ROOM_NAME_UNSTABLE_KEY = "org.matrix.msc4591.formatted_name";

/** The raw formatted name object from m.room.name content, under either key. */
export function getRawFormattedRoomName(content: Record<string, unknown> | undefined): unknown {
    return content?.[FORMATTED_ROOM_NAME_UNSTABLE_KEY] ?? content?.[FORMATTED_ROOM_NAME_STABLE_KEY];
}

/**
 * The formatted name in a room's m.room.name event as safe HTML, in place of `shownName` (the name
 * the caller is showing for the room), or undefined to show the plain name.
 */
export function formattedRoomNameHtml(
    nameEvent: MatrixEvent | null | undefined,
    membership: string | undefined,
    shownName: string | undefined,
): string | undefined {
    if (!nameEvent || membership === KnownMembership.Invite) return undefined;
    const content = nameEvent.getContent();
    const raw = getRawFormattedRoomName(content);
    // Most rooms have none: checked before the setting, which costs more.
    if (!raw) return undefined;
    const name = content.name;
    if (typeof name !== "string" || !name || name !== shownName) return undefined;
    return renderFormattedName(raw, name);
}

/** {@link formattedRoomNameHtml} for a room as it is now. */
export function getRoomFormattedNameHtml(room: Room, shownName: string | undefined = room.name): string | undefined {
    return formattedRoomNameHtml(
        room.currentState.getStateEvents(EventType.RoomName, ""),
        room.getMyMembership(),
        shownName,
    );
}

/** {@link formattedRoomNameHtml}, following the room's name, the user's membership and the lab. */
export function useRoomFormattedNameHtml(room: Room, shownName: string | undefined): string | undefined {
    const nameEvent = useRoomState(room, (state) => state.getStateEvents(EventType.RoomName, ""));
    const membership = useMyRoomMembership(room);
    const enabled = useFeatureEnabled(FORMATTED_NAMES_LAB);
    return useMemo(
        () => (enabled ? formattedRoomNameHtml(nameEvent, membership, shownName) : undefined),
        [enabled, nameEvent, membership, shownName],
    );
}
