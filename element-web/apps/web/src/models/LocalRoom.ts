/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type MatrixClient,
    Room,
    PendingEventOrdering,
    MatrixEvent,
    Direction,
    EventType,
    RoomStateEvent,
} from "matrix-js-sdk/src/matrix";

import { type Member } from "../utils/direct-messages";
import { MEGOLM_ENCRYPTION_ALGORITHM } from "../utils/crypto";

export const LOCAL_ROOM_ID_PREFIX = "local+";

export enum LocalRoomState {
    NEW, // new local room; only known to the client
    CREATING, // real room is being created
    CREATED, // real room has been created via API; events applied
    ERROR, // error during room creation
}

/**
 * A local room that only exists client side.
 * Its main purpose is to be used for temporary rooms when creating a DM.
 */
export class LocalRoom extends Room {
    /** Whether the actual room should be encrypted. */
    public encrypted = false;
    /** If the actual room has been created, this holds its ID. */
    public actualRoomId?: string;
    /** DM chat partner */
    public targets: Member[] = [];
    /** Callbacks that should be invoked after the actual room has been created. */
    public afterCreateCallbacks: ((roomId: string) => void)[] = [];
    public state: LocalRoomState = LocalRoomState.NEW;

    public constructor(roomId: string, client: MatrixClient, myUserId: string) {
        super(roomId, client, myUserId, { pendingEventOrdering: PendingEventOrdering.Detached });
        this.name = this.getDefaultRoomName(myUserId);
    }

    public get isNew(): boolean {
        return this.state === LocalRoomState.NEW;
    }

    public get isCreated(): boolean {
        return this.state === LocalRoomState.CREATED;
    }

    public get isError(): boolean {
        return this.state === LocalRoomState.ERROR;
    }

    /**
     * Check if encryption is enabled in this room.
     * True if the room has any encryption state event
     */
    public isEncryptionEnabled(): boolean {
        const roomState = this.getLiveTimeline().getState(Direction.Forward);
        if (!roomState) return false;

        const stateEvents = roomState.getStateEvents(EventType.RoomEncryption);
        if (stateEvents.length === 0) return false;

        // if there is an encryption state event, it is encrypted.
        // Regardless of the content/algorithm, we assume it is encrypted.
        return stateEvents[0] instanceof MatrixEvent;
    }

    /**
     * Haven: change whether the real room this LocalRoom stands in for should be created encrypted,
     * driven by an explicit user toggle on the pre-send DM screen (see LocalRoomView in RoomView.tsx)
     * rather than only the automatic determineCreateRoomEncryptionOption() check createDmLocalRoom()
     * runs up front. Keeps `encrypted` (read by createRoomFromLocalRoom/startDm at actual send time)
     * and this local room's own `m.room.encryption` state event (read by isEncryptionEnabled() above,
     * and by RoomView.tsx directly for the "Encryption enabled" timeline tile) in sync, then emits
     * RoomStateEvent.Update so anything reactively watching room state - namely
     * EncryptionEventViewModel - refreshes immediately.
     */
    public setEncrypted(client: MatrixClient, encrypted: boolean): void {
        this.encrypted = encrypted;

        const roomState = this.getLiveTimeline().getState(Direction.Forward);
        if (!roomState) return;

        if (encrypted) {
            if (roomState.getStateEvents(EventType.RoomEncryption).length === 0) {
                const userId = client.getUserId()!;
                const event = new MatrixEvent({
                    event_id: `~${this.roomId}:${client.makeTxnId()}`,
                    type: EventType.RoomEncryption,
                    content: { algorithm: MEGOLM_ENCRYPTION_ALGORITHM },
                    sender: userId,
                    state_key: "",
                    room_id: this.roomId,
                    origin_server_ts: Date.now(),
                });
                roomState.setStateEvents([event]);
            }
        } else {
            // There's no protocol-level "unset a state event" - real rooms never do this - but this
            // room only ever exists client-side, so it's safe to drop it back out of the state map
            // directly rather than leave a stale encryption event whose presence would otherwise keep
            // isEncryptionEnabled()/the timeline tile permanently "on" once ever toggled on.
            roomState.events.get(EventType.RoomEncryption)?.delete("");
        }

        this.emit(RoomStateEvent.Update, roomState);
    }
}
