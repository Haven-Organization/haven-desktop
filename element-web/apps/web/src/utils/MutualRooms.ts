/*
 * Haven: rooms the current user and another user are both joined to, for the "Mutual Rooms"
 * button in the user info panel (UserInfoBasicOptionsView) and its MutualRoomsDialog.
 */

import { useEffect, useState } from "react";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

const QUERY_MUTUAL_ROOMS_FEATURE = "uk.half-shot.msc2666.query_mutual_rooms";

/** Sorts rooms by name, so the list (and the button's icon, taken from it) stays stable. */
function sortByName(rooms: Room[]): Room[] {
    return rooms.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a room should be listed: a joined, non-space room. */
function isListable(room: Room | null): room is Room {
    return !!room && room.getMyMembership() === KnownMembership.Join && !room.isSpaceRoom();
}

/**
 * Mutual rooms from what the client already knows: the rooms we're joined to where `userId` is a
 * joined member. With lazy-loaded members a room only counts once that user's membership has been
 * loaded there (e.g. they've spoken in the loaded timeline), so this can undercount.
 */
export function getLocalMutualRooms(client: MatrixClient, userId: string): Room[] {
    return sortByName(
        client
            .getRooms()
            .filter((room) => isListable(room) && room.getMember(userId)?.membership === KnownMembership.Join),
    );
}

/**
 * Mutual rooms with `userId`, sorted by name; null while loading. Asks the server (MSC2666) when
 * it really supports it, since it knows every member of every room; otherwise, or if that request
 * fails, uses {@link getLocalMutualRooms}. Some servers advertise MSC2666 without serving it, so a
 * failed request is expected and only logged.
 */
export function useMutualRooms(client: MatrixClient, userId: string): Room[] | null {
    const [rooms, setRooms] = useState<Room[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        setRooms(null);
        if (userId === client.getUserId()) {
            setRooms([]);
            return;
        }

        const load = async (): Promise<Room[]> => {
            try {
                if (await client.doesServerSupportUnstableFeature(QUERY_MUTUAL_ROOMS_FEATURE)) {
                    const roomIds = await client._unstable_getSharedRooms(userId);
                    return sortByName(roomIds.map((id) => client.getRoom(id)).filter(isListable));
                }
            } catch (e) {
                logger.info("Mutual rooms request failed, using locally known rooms instead", e);
            }
            return getLocalMutualRooms(client, userId);
        };

        void load().then((result) => {
            if (!cancelled) setRooms(result);
        });
        return () => {
            cancelled = true;
        };
    }, [client, userId]);

    return rooms;
}

/** Shortens a count of 1,000 or more, e.g. 1324 becomes "1.3k" and 2,500,000 becomes "2.5m". */
export function formatMutualRoomCount(count: number): string {
    const shorten = (value: number, suffix: string): string =>
        `${(Math.floor(value * 10) / 10).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    if (count >= 1_000_000) return shorten(count / 1_000_000, "m");
    if (count >= 1000) return shorten(count / 1000, "k");
    return String(count);
}

/**
 * The room whose avatar the Mutual Rooms button shows: the first one in the list with an avatar,
 * preferring any room other than the one currently open. Null when none of them has an avatar.
 */
export function pickMutualRoomsIconRoom(rooms: Room[], currentRoomId: string | undefined): Room | null {
    const withAvatar = rooms.filter((room) => !!room.getMxcAvatarUrl());
    return withAvatar.find((room) => room.roomId !== currentRoomId) ?? withAvatar[0] ?? null;
}

/** Whether `room` matches a search on its name, canonical/alternative aliases or room ID. */
export function mutualRoomMatches(room: Room, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const fields = [room.name, room.roomId, room.getCanonicalAlias(), ...room.getAltAliases()];
    return fields.some((field) => !!field && field.toLowerCase().includes(q));
}
