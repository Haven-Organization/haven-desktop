/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { type Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../../settings/SettingsStore";
import { FILTER_CHANGED } from "./IFilterCondition";
import { SpaceFilterCondition } from "./SpaceFilterCondition";
import { MetaSpace, type SpaceKey } from "../../../stores/spaces";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import type SpaceStore from "../../../stores/spaces/SpaceStore";

vi.mock("../../../settings/SettingsStore");
// SDKContextClass builds its own SpaceStore, so the store the filter talks to is swapped in via its getter
// (see beforeEach) rather than by mocking the SpaceStore module.
class MockSpaceStore extends EventEmitter {
    public isRoomInSpace = vi.fn();
    public getSpaceFilteredUserIds = vi.fn().mockReturnValue(new Set<string>([]));
    public getSpaceFilteredRoomIds = vi.fn().mockReturnValue(new Set<string>([]));
}
const mockSpaceStore = new MockSpaceStore();

const SettingsStoreMock = vi.mocked(SettingsStore);
const SpaceStoreInstanceMock = vi.mocked(mockSpaceStore);

vi.useFakeTimers();

describe("SpaceFilterCondition", () => {
    const space1 = "!space1:server";
    const space2 = "!space2:server";
    const room1Id = "!r1:server";
    const room2Id = "!r2:server";
    const room3Id = "!r3:server";
    const user1Id = "@u1:server";
    const user2Id = "@u2:server";
    const user3Id = "@u3:server";
    const makeMockGetValue =
        (settings: Record<string, any> = {}) =>
        // `any` params: SettingsStore.getValue's own signature is keyed on setting names / roomIds
        // these fixtures deliberately don't model.
        (settingName: any, space: any) =>
            settings[settingName]?.[space as SpaceKey] || false;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(SDKContextClass.instance, "spaceStore", "get").mockReturnValue(mockSpaceStore as unknown as SpaceStore);
        SettingsStoreMock.getValue.mockClear().mockImplementation(makeMockGetValue());
        SpaceStoreInstanceMock.getSpaceFilteredUserIds.mockReturnValue(new Set([]));
        SpaceStoreInstanceMock.isRoomInSpace.mockReturnValue(true);
    });

    const initFilter = (space: SpaceKey): SpaceFilterCondition => {
        const filter = new SpaceFilterCondition();
        filter.updateSpace(space);
        vi.runOnlyPendingTimers();
        return filter;
    };

    describe("isVisible", () => {
        const room1 = { roomId: room1Id } as unknown as Room;
        it("calls isRoomInSpace correctly", () => {
            const filter = initFilter(space1);

            expect(filter.isVisible(room1)).toEqual(true);
            expect(SpaceStoreInstanceMock.isRoomInSpace).toHaveBeenCalledWith(space1, room1Id);
        });
    });

    describe("onStoreUpdate", () => {
        it("emits filter changed event when updateSpace is called even without changes", async () => {
            const filter = new SpaceFilterCondition();
            const emitSpy = vi.spyOn(filter, "emit");
            filter.updateSpace(space1);
            vi.runOnlyPendingTimers();
            expect(emitSpy).toHaveBeenCalledWith(FILTER_CHANGED);
        });

        describe("showPeopleInSpace setting", () => {
            it("emits filter changed event when setting changes", async () => {
                // init filter with setting true for space1
                SettingsStoreMock.getValue.mockImplementation(
                    makeMockGetValue({
                        ["Spaces.showPeopleInSpace"]: { [space1]: true },
                    }),
                );
                const filter = initFilter(space1);
                const emitSpy = vi.spyOn(filter, "emit");

                SettingsStoreMock.getValue.mockClear().mockImplementation(
                    makeMockGetValue({
                        ["Spaces.showPeopleInSpace"]: { [space1]: false },
                    }),
                );

                SpaceStoreInstanceMock.emit(space1);
                vi.runOnlyPendingTimers();
                expect(emitSpy).toHaveBeenCalledWith(FILTER_CHANGED);
            });

            it("emits filter changed event when setting is false and space changes to a meta space", async () => {
                // init filter with setting true for space1
                SettingsStoreMock.getValue.mockImplementation(
                    makeMockGetValue({
                        ["Spaces.showPeopleInSpace"]: { [space1]: false },
                    }),
                );
                const filter = initFilter(space1);
                const emitSpy = vi.spyOn(filter, "emit");

                filter.updateSpace(MetaSpace.Home);
                vi.runOnlyPendingTimers();
                expect(emitSpy).toHaveBeenCalledWith(FILTER_CHANGED);
            });
        });

        it("does not emit filter changed event on store update when nothing changed", async () => {
            const filter = initFilter(space1);
            const emitSpy = vi.spyOn(filter, "emit");
            SpaceStoreInstanceMock.emit(space1);
            vi.runOnlyPendingTimers();
            expect(emitSpy).not.toHaveBeenCalledWith(FILTER_CHANGED);
        });

        it("removes listener when updateSpace is called", async () => {
            const filter = initFilter(space1);
            filter.updateSpace(space2);
            vi.runOnlyPendingTimers();
            const emitSpy = vi.spyOn(filter, "emit");

            // update mock so filter would emit change if it was listening to space1
            SpaceStoreInstanceMock.getSpaceFilteredRoomIds.mockReturnValue(new Set([room1Id]));
            SpaceStoreInstanceMock.emit(space1);
            vi.runOnlyPendingTimers();
            // no filter changed event
            expect(emitSpy).not.toHaveBeenCalledWith(FILTER_CHANGED);
        });

        it("removes listener when destroy is called", async () => {
            const filter = initFilter(space1);
            filter.destroy();
            vi.runOnlyPendingTimers();
            const emitSpy = vi.spyOn(filter, "emit");

            // update mock so filter would emit change if it was listening to space1
            SpaceStoreInstanceMock.getSpaceFilteredRoomIds.mockReturnValue(new Set([room1Id]));
            SpaceStoreInstanceMock.emit(space1);
            vi.runOnlyPendingTimers();
            // no filter changed event
            expect(emitSpy).not.toHaveBeenCalledWith(FILTER_CHANGED);
        });

        describe("when directChildRoomIds change", () => {
            beforeEach(() => {
                SpaceStoreInstanceMock.getSpaceFilteredRoomIds.mockReturnValue(new Set([room1Id, room2Id]));
            });
            const filterChangedCases = [
                ["room added", [room1Id, room2Id, room3Id]],
                ["room removed", [room1Id]],
                ["room swapped", [room1Id, room3Id]], // same number of rooms with changes
            ];

            it.each(filterChangedCases)("%s", (_d, rooms) => {
                const filter = initFilter(space1);
                const emitSpy = vi.spyOn(filter, "emit");

                SpaceStoreInstanceMock.getSpaceFilteredRoomIds.mockReturnValue(new Set(rooms));
                SpaceStoreInstanceMock.emit(space1);
                vi.runOnlyPendingTimers();
                expect(emitSpy).toHaveBeenCalledWith(FILTER_CHANGED);
            });
        });

        describe("when user ids change", () => {
            beforeEach(() => {
                SpaceStoreInstanceMock.getSpaceFilteredUserIds.mockReturnValue(new Set([user1Id, user2Id]));
            });
            const filterChangedCases = [
                ["user added", [user1Id, user2Id, user3Id]],
                ["user removed", [user1Id]],
                ["user swapped", [user1Id, user3Id]], // same number of rooms with changes
            ];

            it.each(filterChangedCases)("%s", (_d, rooms) => {
                const filter = initFilter(space1);
                const emitSpy = vi.spyOn(filter, "emit");

                SpaceStoreInstanceMock.getSpaceFilteredUserIds.mockReturnValue(new Set(rooms));
                SpaceStoreInstanceMock.emit(space1);
                vi.runOnlyPendingTimers();
                expect(emitSpy).toHaveBeenCalledWith(FILTER_CHANGED);
            });
        });
    });
});
