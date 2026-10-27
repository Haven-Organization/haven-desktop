/*
 * Haven: tests for webxdc realtime channels.
 */

// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getMockClientWithEventEmitter } from "test-utils";
import { WebxdcRealtime, WebxdcRealtimeError, WEBXDC_REALTIME_TYPE } from "./WebxdcRealtime";

const ROOM = "!room:example.org";
const GAME = "$game";

function room(members: string[], encrypted = false) {
    return {
        roomId: ROOM,
        getJoinedMembers: () => members.map((userId) => ({ userId })),
        getMember: (userId: string) => (members.includes(userId) ? { membership: "join" } : null),
        hasEncryptionStateEvent: () => encrypted,
    };
}

describe("WebxdcRealtime", () => {
    let client: MatrixClient;
    let encrypted: boolean;
    let members: string[];

    beforeEach(() => {
        encrypted = false;
        members = ["@alice:example.org", "@bob:example.org"];
        client = getMockClientWithEventEmitter({
            getRoom: vi.fn(() => room(members, encrypted)),
            getUserId: vi.fn().mockReturnValue("@alice:example.org"),
            getDeviceId: vi.fn().mockReturnValue("ALICEPHONE"),
            sendToDevice: vi.fn().mockResolvedValue({}),
            encryptAndSendToDevice: vi.fn().mockResolvedValue(undefined),
            getCrypto: vi.fn(() => ({
                isEncryptionEnabledInRoom: async () => encrypted,
                getUserDeviceInfo: async (userIds: string[]) =>
                    new Map(
                        userIds.map((userId) => [
                            userId,
                            new Map(
                                userId === "@alice:example.org"
                                    ? [
                                          ["ALICEPHONE", {}],
                                          ["ALICELAPTOP", {}],
                                      ]
                                    : [["BOBPHONE", {}]],
                            ),
                        ]),
                    ),
            })),
        });
    });

    it("sends a packet to everyone in a plain room", async () => {
        await new WebxdcRealtime(client).send(ROOM, GAME, new Uint8Array([1, 2, 3]));
        const [type, contentMap] = vi.mocked(client.sendToDevice).mock.calls[0];
        expect(type).toBe(WEBXDC_REALTIME_TYPE);
        expect([...contentMap.keys()]).toEqual(members);
        expect(contentMap.get("@bob:example.org")?.get("*")).toEqual({
            room_id: ROOM,
            event_id: GAME,
            from_device: "ALICEPHONE",
            data: "AQID",
        });
    });

    it("encrypts packets in an encrypted room, to every device but this one", async () => {
        encrypted = true;
        await new WebxdcRealtime(client).send(ROOM, GAME, new Uint8Array([1]));
        expect(client.sendToDevice).not.toHaveBeenCalled();
        const [, devices] = vi.mocked(client.encryptAndSendToDevice).mock.calls[0];
        expect(devices).toEqual([
            { userId: "@alice:example.org", deviceId: "ALICELAPTOP" },
            { userId: "@bob:example.org", deviceId: "BOBPHONE" },
        ]);
    });

    it("isn't offered in a room too big for it", () => {
        members = Array.from({ length: 60 }, (_, i) => `@user${i}:example.org`);
        expect(() => new WebxdcRealtime(client).join(ROOM, GAME, vi.fn())).toThrow(WebxdcRealtimeError);
    });

    it("refuses a packet too large", async () => {
        await expect(new WebxdcRealtime(client).send(ROOM, GAME, new Uint8Array(40_000))).rejects.toThrow(
            WebxdcRealtimeError,
        );
    });

    describe("receiving", () => {
        const packet = (sender: string, fromDevice = "BOBPHONE", event = GAME) => ({
            message: {
                type: WEBXDC_REALTIME_TYPE,
                sender,
                content: { room_id: ROOM, event_id: event, from_device: fromDevice, data: "AQID" },
            },
            encryptionInfo: null,
        });

        it("hands the game a packet from another player", () => {
            const hub = new WebxdcRealtime(client);
            const listener = vi.fn();
            hub.join(ROOM, GAME, listener);
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@bob:example.org") as any);
            expect(listener).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        });

        it("ignores this device's own packets, other games, strangers, and leaving", () => {
            const hub = new WebxdcRealtime(client);
            const listener = vi.fn();
            const leave = hub.join(ROOM, GAME, listener);
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@alice:example.org", "ALICEPHONE") as any);
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@bob:example.org", "BOBPHONE", "$other") as any);
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@mallory:example.org") as any);
            leave();
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@bob:example.org") as any);
            expect(listener).not.toHaveBeenCalled();
        });

        it("ignores an unencrypted packet for an encrypted room", () => {
            encrypted = true;
            const hub = new WebxdcRealtime(client);
            const listener = vi.fn();
            hub.join(ROOM, GAME, listener);
            client.emit(ClientEvent.ReceivedToDeviceMessage, packet("@bob:example.org") as any);
            expect(listener).not.toHaveBeenCalled();
        });
    });
});
