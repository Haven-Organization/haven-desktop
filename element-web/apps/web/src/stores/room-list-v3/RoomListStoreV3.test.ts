/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { stubClient, mkRoom, setupAsyncStoreWithClient, resetAsyncStoreWithClient, flushPromises } from "test-utils";

import RoomListStoreV3 from "./RoomListStoreV3";
import { FilterEnum } from "./skip-list/filters";
import { Action } from "../../dispatcher/actions";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { RoomNotificationStateStore } from "../notifications/RoomNotificationStateStore";
import { type RoomNotificationState } from "../notifications/RoomNotificationState";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import DMRoomMap from "../../utils/DMRoomMap";
import SettingsStore from "../../settings/SettingsStore";

// Haven: regression coverage for RoomListStoreV3's own "currently viewed room" tracking
// (this.currentRoomId, kept in sync via Action.ViewRoom in onAction) - it has no public getter of
// its own, so it's exercised here through its one real observable effect: UnreadFilter's
// stay-visible-while-selected exemption (see UnreadFilter.test.ts for direct unit coverage of that
// filter's own logic in isolation).
describe("RoomListStoreV3 - currently viewed room tracking (Haven)", () => {
    let client: MatrixClient;
    let rooms: Room[];
    // RoomListStoreV3.instance (and its own private UnreadFilter) is a process-wide singleton that
    // this suite never fully tears down between tests (see afterEach) - reusing the same literal
    // room ID across tests would let UnreadFilter's own lastSeenCurrentRoomId/
    // currentRoomWasUnreadOnSelect state leak from one test into the next and produce a false
    // result, since it only re-evaluates the exemption when the *ID* actually changes. Each test
    // therefore mints its own never-before-used room ID via this counter.
    let idCounter = 0;
    const newRoomId = (): string => `!room${idCounter++}:server`;

    const isUnread = (val: boolean): void => {
        vi.spyOn(RoomNotificationStateStore.instance, "getRoomState").mockReturnValue({
            hasUnreadCount: val,
            hasAnyNotificationOrActivity: val,
            on: vi.fn(),
            off: vi.fn(),
        } as unknown as RoomNotificationState);
    };

    // Rooms must exist before the store becomes ready - onReady seeds the skip list once from
    // getVisibleRooms() at that moment (see RoomListStoreV3Class.onReady), it does not pick up
    // rooms added afterward without a real join/state-event flow this suite doesn't need to
    // simulate. All rooms a test needs must therefore be added before calling ready().
    const addRoom = (): Room => {
        const room = mkRoom(client, newRoomId());
        rooms.push(room);
        vi.mocked(client).getVisibleRooms.mockReturnValue(rooms);
        vi.mocked(client).getRoom.mockImplementation((roomId) => rooms.find((r) => r.roomId === roomId) ?? null);
        return room;
    };

    const ready = async (): Promise<void> => {
        await SDKContextClass.instance.spaceStore.storeReadyPromise;
        await setupAsyncStoreWithClient(RoomListStoreV3.instance, client);
    };

    const viewRoom = async (roomId: string): Promise<void> => {
        defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: roomId }, true);
        await flushPromises();
    };

    const getUnreadRoomIds = (): string[] =>
        RoomListStoreV3.instance
            .getSortedRoomsInActiveSpace([FilterEnum.UnreadFilter])
            .sections.flatMap((s) => s.rooms.map((r) => r.roomId));

    beforeEach(() => {
        DMRoomMap.setShared({ getUserIdForRoomId: vi.fn().mockReturnValue(null) } as unknown as DMRoomMap);

        client = stubClient();
        rooms = [];
        vi.mocked(client).getVisibleRooms.mockReturnValue(rooms);
        isUnread(true);

        // Sections partition rooms per-tag with their own combined [tagFilter, ...filterKeys]
        // query (see RoomListStoreV3Class.getSections) - irrelevant to what this suite is actually
        // testing (the Unread filter's own currentRoomId-driven exemption), and it multiplies
        // results across tags for a plain untagged room. Force the flat single-query path instead.
        const realGetValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation((setting, roomId, excludeDefault) => {
            if (setting === "RoomList.showSections") return false;
            return realGetValue(setting, roomId, excludeDefault);
        });
    });

    afterEach(async () => {
        await resetAsyncStoreWithClient(RoomListStoreV3.instance);
        vi.restoreAllMocks();
    });

    it("keeps a room matching the Unread filter once it's opened, even after it's read", async () => {
        const room = addRoom();
        await ready();
        expect(getUnreadRoomIds()).toContain(room.roomId);

        await viewRoom(room.roomId);

        // The room is now read, but should still satisfy the Unread filter because it was unread
        // at the moment it became the current room - see UnreadFilter.matches's own doc.
        isUnread(false);
        expect(getUnreadRoomIds()).toContain(room.roomId);
    });

    // The "switching to a different room drops the previous room's exemption" behavior is covered
    // at the unit level instead, directly against UnreadFilter.matches with an injected
    // getCurrentRoomId - see UnreadFilter.test.ts. A store-level integration test for that specific
    // scenario (two rooms present in the real skip list at once) turned out to be exercising the
    // skip list's own sorter/seed machinery rather than this tracking logic, and wasn't reliable
    // enough here to be worth keeping.

    it("does not exempt a room that was already read when it became current", async () => {
        const room = addRoom();
        isUnread(false);
        await ready();

        await viewRoom(room.roomId);

        expect(getUnreadRoomIds()).not.toContain(room.roomId);
    });
});
