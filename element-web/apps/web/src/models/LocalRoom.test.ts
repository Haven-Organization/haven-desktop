/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    Direction,
    EventType,
    type MatrixClient,
    MatrixEvent,
    RoomStateEvent,
} from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { LocalRoom, LocalRoomState, LOCAL_ROOM_ID_PREFIX } from "./LocalRoom";

const stateTestData = [
    {
        name: "NEW",
        state: LocalRoomState.NEW,
        isNew: true,
        isCreated: false,
        isError: false,
    },
    {
        name: "CREATING",
        state: LocalRoomState.CREATING,
        isNew: false,
        isCreated: false,
        isError: false,
    },
    {
        name: "CREATED",
        state: LocalRoomState.CREATED,
        isNew: false,
        isCreated: true,
        isError: false,
    },
    {
        name: "ERROR",
        state: LocalRoomState.ERROR,
        isNew: false,
        isCreated: false,
        isError: true,
    },
];

describe("LocalRoom", () => {
    let room: LocalRoom;
    let client: MatrixClient;

    beforeEach(() => {
        client = createTestClient();
        room = new LocalRoom(LOCAL_ROOM_ID_PREFIX + "test", client, "@test:localhost");
    });

    it("should not raise an error on getPendingEvents (implicitly check for pendingEventOrdering: detached)", () => {
        room.getPendingEvents();
        expect(true).toBe(true);
    });

    it("should not have after create callbacks", () => {
        expect(room.afterCreateCallbacks).toHaveLength(0);
    });

    stateTestData.forEach((stateTestDatum) => {
        describe(`in state ${stateTestDatum.name}`, () => {
            beforeEach(() => {
                room.state = stateTestDatum.state;
            });

            it(`isNew should return ${stateTestDatum.isNew}`, () => {
                expect(room.isNew).toBe(stateTestDatum.isNew);
            });

            it(`isCreated should return ${stateTestDatum.isCreated}`, () => {
                expect(room.isCreated).toBe(stateTestDatum.isCreated);
            });

            it(`isError should return ${stateTestDatum.isError}`, () => {
                expect(room.isError).toBe(stateTestDatum.isError);
            });
        });
    });

    it("should return false for isEncryptionEnabled with no state", () => {
        expect(room.isEncryptionEnabled()).toBe(false);
    });

    it("should return true for isEncryptionEnabled with an encryption state event", () => {
        const encryptionEvent = new MatrixEvent({
            type: EventType.RoomEncryption,
            state_key: "",
            content: {
                algorithm: "m.megolm.v1.aes-sha2",
            },
            sender: "@test:localhost",
            room_id: room.roomId,
            event_id: "$test:localhost",
        });

        const roomState = room.getLiveTimeline().getState(Direction.Forward);
        roomState?.setStateEvents([encryptionEvent]);

        expect(room.isEncryptionEnabled()).toBe(true);
    });

    // Haven: regression coverage for LocalRoom.setEncrypted(), the hook behind the pre-send DM
    // screen's "Enable end-to-end encryption" toggle (LocalRoomView in RoomView.tsx). It has to keep
    // the `encrypted` flag createRoomFromLocalRoom reads at send time and the room's own
    // m.room.encryption state event (which isEncryptionEnabled(), the timeline tile and the composer
    // all read) in lockstep - if a merge drops either half the toggle silently stops doing anything.
    describe("setEncrypted", () => {
        const encryptionEvents = (): MatrixEvent[] =>
            room.getLiveTimeline().getState(Direction.Forward)!.getStateEvents(EventType.RoomEncryption);

        it("sets the encrypted flag and adds an encryption state event when enabling", () => {
            room.setEncrypted(client, true);

            expect(room.encrypted).toBe(true);
            expect(room.isEncryptionEnabled()).toBe(true);
            expect(encryptionEvents()).toHaveLength(1);
            expect(encryptionEvents()[0].getContent().algorithm).toBe("m.megolm.v1.aes-sha2");
        });

        it("does not add a second encryption event when enabling twice", () => {
            room.setEncrypted(client, true);
            const first = encryptionEvents()[0];
            room.setEncrypted(client, true);

            expect(encryptionEvents()).toHaveLength(1);
            expect(encryptionEvents()[0]).toBe(first);
        });

        it("clears the flag and removes the encryption state event when disabling", () => {
            room.setEncrypted(client, true);
            room.setEncrypted(client, false);

            expect(room.encrypted).toBe(false);
            expect(encryptionEvents()).toHaveLength(0);
            // A stale event left behind would keep this true forever once toggled on - see setEncrypted's doc.
            expect(room.isEncryptionEnabled()).toBe(false);
        });

        it("removes an encryption event that was there from the start (createDmLocalRoom's own)", () => {
            const initial = new MatrixEvent({
                type: EventType.RoomEncryption,
                state_key: "",
                content: { algorithm: "m.megolm.v1.aes-sha2" },
                sender: "@test:localhost",
                room_id: room.roomId,
                event_id: "$initial:localhost",
            });
            room.getLiveTimeline().getState(Direction.Forward)!.setStateEvents([initial]);
            room.encrypted = true;

            room.setEncrypted(client, false);

            expect(room.isEncryptionEnabled()).toBe(false);
            expect(room.encrypted).toBe(false);
        });

        it("can be toggled on, off and on again", () => {
            room.setEncrypted(client, true);
            room.setEncrypted(client, false);
            room.setEncrypted(client, true);

            expect(room.encrypted).toBe(true);
            expect(room.isEncryptionEnabled()).toBe(true);
            expect(encryptionEvents()).toHaveLength(1);
        });

        it("does not throw when disabling a room that was never encrypted", () => {
            expect(() => room.setEncrypted(client, false)).not.toThrow();
            expect(room.encrypted).toBe(false);
            expect(room.isEncryptionEnabled()).toBe(false);
        });

        it("emits RoomStateEvent.Update on the room for every change", () => {
            const onUpdate = vi.fn();
            room.on(RoomStateEvent.Update, onUpdate);
            const state = room.getLiveTimeline().getState(Direction.Forward);

            // Enabling may emit more than once (the SDK's own emit for the new state event, plus
            // setEncrypted's explicit one) - what matters is that listeners always hear about it.
            room.setEncrypted(client, true);
            expect(onUpdate).toHaveBeenCalled();
            expect(onUpdate).toHaveBeenLastCalledWith(state);

            // Removing an event from the state map emits nothing by itself, so this is the explicit
            // emit alone - exactly what EncryptionEventViewModel refreshes off.
            onUpdate.mockClear();
            room.setEncrypted(client, false);
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith(state);
        });
    });
});
