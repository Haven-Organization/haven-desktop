/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";
import { mkStubRoom, stubClient } from "test-utils";

import { UnreadFilter } from "./UnreadFilter";
import { FilterEnum } from ".";
import { RoomNotificationStateStore } from "../../../notifications/RoomNotificationStateStore";
import { type RoomNotificationState } from "../../../notifications/RoomNotificationState";
import SettingsStore from "../../../../settings/SettingsStore";

// Haven: direct unit coverage for UnreadFilter's own "stay visible while selected" exemption -
// see the class's own doc comments. Integration coverage for the store wiring this filter up to
// the real "currently viewed room" is in ../../RoomListStoreV3.test.ts.
describe("UnreadFilter", () => {
    let room: Room;
    let currentRoomId: string | undefined;

    const setUnread = (val: boolean): void => {
        vi.spyOn(RoomNotificationStateStore.instance, "getRoomState").mockReturnValue({
            hasUnreadCount: val,
            hasAnyNotificationOrActivity: val,
            on: vi.fn(),
            off: vi.fn(),
        } as unknown as RoomNotificationState);
    };

    const setShowAllUnread = (val: boolean): void => {
        vi.spyOn(SettingsStore, "getValue").mockImplementation((setting) =>
            setting === "Haven.showAllUnreadRoomsInUnreadsFilter" ? val : null,
        );
    };

    beforeEach(() => {
        stubClient();
        room = mkStubRoom("!room:server", "Room", undefined);
        currentRoomId = undefined;
        setShowAllUnread(false);
        setUnread(false);
    });

    const filter = (): UnreadFilter => new UnreadFilter(() => currentRoomId);

    it("reports its own key", () => {
        expect(filter().key).toBe(FilterEnum.UnreadFilter);
    });

    it("matches a room with an unread notification count", () => {
        setUnread(true);
        expect(filter().matches(room)).toBe(true);
    });

    it("does not match a fully-read room that isn't selected", () => {
        setUnread(false);
        expect(filter().matches(room)).toBe(false);
    });

    it("matches a marked-unread room even with no notification count", () => {
        setUnread(false);
        vi.spyOn(room, "getAccountData").mockReturnValue({
            getContent: () => ({ unread: true }),
        } as any);
        expect(filter().matches(room)).toBe(true);
    });

    describe("Haven.showAllUnreadRoomsInUnreadsFilter setting", () => {
        it("only matches hasUnreadCount when the setting is off", () => {
            setShowAllUnread(false);
            vi.spyOn(RoomNotificationStateStore.instance, "getRoomState").mockReturnValue({
                hasUnreadCount: false,
                hasAnyNotificationOrActivity: true, // plain activity, no real unread-count badge
                on: vi.fn(),
                off: vi.fn(),
            } as unknown as RoomNotificationState);

            expect(filter().matches(room)).toBe(false);
        });

        it("matches plain activity too when the setting is on", () => {
            setShowAllUnread(true);
            vi.spyOn(RoomNotificationStateStore.instance, "getRoomState").mockReturnValue({
                hasUnreadCount: false,
                hasAnyNotificationOrActivity: true,
                on: vi.fn(),
                off: vi.fn(),
            } as unknown as RoomNotificationState);

            expect(filter().matches(room)).toBe(true);
        });
    });

    describe("selected-room exemption", () => {
        it("stays visible after being selected while unread, even once it's since been read", () => {
            const f = filter();
            setUnread(true);
            currentRoomId = room.roomId;
            expect(f.matches(room)).toBe(true); // selected while unread

            setUnread(false);
            expect(f.matches(room)).toBe(true); // still exempt - decided at selection time
        });

        it("does not exempt a room that was already read at the moment it was selected", () => {
            const f = filter();
            setUnread(false);
            currentRoomId = room.roomId;
            expect(f.matches(room)).toBe(false);

            // Even if it later becomes unread while still selected, the exemption was decided once,
            // at selection time, and isn't re-evaluated just because the room is still current -
            // though it will match anyway here since it's now genuinely unread on its own merits.
            setUnread(true);
            expect(f.matches(room)).toBe(true);
        });

        it("drops the exemption once a different room becomes current", () => {
            const otherRoom = mkStubRoom("!other:server", "Other Room", undefined);
            const f = filter();

            setUnread(true);
            currentRoomId = room.roomId;
            expect(f.matches(room)).toBe(true);

            setUnread(false);
            expect(f.matches(room)).toBe(true); // still exempt while still selected

            // Switch to a different room - room is no longer current, and is read, so it should
            // stop matching. This is the exact regression this suite exists to pin down: the
            // exemption must not "stick" to a room just because it was once granted.
            currentRoomId = otherRoom.roomId;
            expect(f.matches(room)).toBe(false);
        });

        it("re-evaluates the exemption fresh each time a room becomes selected again", () => {
            const f = filter();

            setUnread(false);
            currentRoomId = room.roomId;
            expect(f.matches(room)).toBe(false); // read at selection time, no exemption

            const otherRoom = mkStubRoom("!other:server", "Other Room", undefined);
            currentRoomId = otherRoom.roomId;
            // Querying the room that's actually now current is what invalidates the tracked
            // exemption for `room` (see matches's own `if (currentRoomId === room.roomId)` guard -
            // it only re-evaluates when the room being matched IS the current one; a real room list
            // queries every room on each render, otherRoom included, so this always happens too).
            f.matches(otherRoom);

            setUnread(true);
            currentRoomId = room.roomId;
            expect(f.matches(room)).toBe(true); // unread this time it was (re-)selected

            setUnread(false);
            expect(f.matches(room)).toBe(true); // and now exempt, unlike the first time around
        });
    });
});
