/*
 * Haven: webxdc realtime channels (joinRealtimeChannel in the webxdc spec): small, unsaved packets
 * between the players of a game who are in it at the moment, such as positions in an action game.
 *
 * Packets go to the room's members as to-device messages, encrypted in an encrypted room. Matrix
 * has no way to address only the players, so everyone joined gets them and the clients of those
 * not playing drop them. That's why realtime is offered only in rooms of modest size.
 */

import { ClientEvent, type MatrixClient, type ReceivedToDeviceMessage } from "matrix-js-sdk/src/matrix";

export const WEBXDC_REALTIME_TYPE = "software.haven.webxdc.realtime";
/** Largest packet: to-device messages have to stay well inside Matrix's 64 KiB limit. */
export const WEBXDC_REALTIME_MAX_SIZE = 32_000;
/** Rooms with more members than this don't get realtime, plain or encrypted. */
const MAX_MEMBERS = 50;
const MAX_MEMBERS_ENCRYPTED = 20;

export class WebxdcRealtimeError extends Error {}

interface Packet {
    room_id?: unknown;
    event_id?: unknown;
    from_device?: unknown;
    data?: unknown;
}

function toBase64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const hubs = new WeakMap<MatrixClient, WebxdcRealtime>();

export class WebxdcRealtime {
    public static for(client: MatrixClient): WebxdcRealtime {
        let hub = hubs.get(client);
        if (!hub) {
            hub = new WebxdcRealtime(client);
            hubs.set(client, hub);
        }
        return hub;
    }

    /** Listeners, by room and game event. */
    private readonly channels = new Map<string, Set<(data: Uint8Array) => void>>();

    public constructor(private readonly client: MatrixClient) {
        client.on(ClientEvent.ReceivedToDeviceMessage, this.onToDevice);
    }

    /**
     * Join a game's channel: `listener` gets the other players' packets until the returned
     * function is called. Throws WebxdcRealtimeError in a room too big for realtime.
     */
    public join(roomId: string, eventId: string, listener: (data: Uint8Array) => void): () => void {
        this.members(roomId); // throws for a room too big
        const key = `${roomId}|${eventId}`;
        let listeners = this.channels.get(key);
        if (!listeners) {
            listeners = new Set();
            this.channels.set(key, listeners);
        }
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (!listeners.size) this.channels.delete(key);
        };
    }

    /** Send a packet to the game's other players. */
    public async send(roomId: string, eventId: string, data: Uint8Array): Promise<void> {
        if (data.length > WEBXDC_REALTIME_MAX_SIZE) throw new WebxdcRealtimeError("packet too large");
        const crypto = this.client.getCrypto();
        const encrypted = !!crypto && (await crypto.isEncryptionEnabledInRoom(roomId));
        const members = this.members(roomId, encrypted);
        const payload = {
            room_id: roomId,
            event_id: eventId,
            from_device: this.client.getDeviceId(),
            data: toBase64(data),
        };
        if (encrypted && crypto) {
            const devices: { userId: string; deviceId: string }[] = [];
            const ownDevice = this.client.getDeviceId();
            for (const [userId, userDevices] of await crypto.getUserDeviceInfo(members)) {
                for (const deviceId of userDevices.keys()) {
                    if (userId === this.client.getUserId() && deviceId === ownDevice) continue;
                    devices.push({ userId, deviceId });
                }
            }
            if (devices.length) await this.client.encryptAndSendToDevice(WEBXDC_REALTIME_TYPE, devices, payload);
            return;
        }
        const contentMap = new Map(members.map((userId) => [userId, new Map([["*", payload]])]));
        await this.client.sendToDevice(WEBXDC_REALTIME_TYPE, contentMap);
    }

    private members(roomId: string, encrypted = false): string[] {
        const room = this.client.getRoom(roomId);
        if (!room) throw new WebxdcRealtimeError("not in the room");
        const members = room.getJoinedMembers().map((member) => member.userId);
        if (members.length > (encrypted ? MAX_MEMBERS_ENCRYPTED : MAX_MEMBERS)) {
            throw new WebxdcRealtimeError("room too big for realtime");
        }
        return members;
    }

    private readonly onToDevice = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
        if (message.type !== WEBXDC_REALTIME_TYPE) return;
        const packet = (message.content ?? {}) as Packet;
        if (typeof packet.room_id !== "string" || typeof packet.event_id !== "string") return;
        if (typeof packet.data !== "string") return;
        const sender = message.sender;
        if (sender === this.client.getUserId() && packet.from_device === this.client.getDeviceId()) return;
        // Only from someone in the room the game's in, and encrypted when the room is.
        const room = this.client.getRoom(packet.room_id);
        if (room?.getMember(sender)?.membership !== "join") return;
        if (room.hasEncryptionStateEvent() && !encryptionInfo) return;
        const listeners = this.channels.get(`${packet.room_id}|${packet.event_id}`);
        if (!listeners) return;
        let data: Uint8Array;
        try {
            data = fromBase64(packet.data);
        } catch {
            return;
        }
        for (const listener of [...listeners]) listener(data);
    };
}
