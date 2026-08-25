// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { JoinRule, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import {
    IMAGE_SOURCE_PACKS_KEY,
    buildImageSourcePacks,
    buildImageSourcePacksFromModel,
    getImageSourcePackRefs,
} from "./imageSourcePacks";
import { Type, type Part } from "../editor/parts";
import type EditorModel from "../editor/model";
import SettingsStore from "../settings/SettingsStore";
import { mkStubRoom, mkEvent } from "../../test/test-utils/test-utils";

vi.mock("../settings/SettingsStore");
vi.mock("./permalinks/Permalinks", () => ({
    calculateRoomVia: vi.fn(() => ["example.org"]),
}));

const SettingsStoreMock = vi.mocked(SettingsStore);

// Haven: MSC4459 (image pack references) provenance metadata - regression coverage for the
// send-side gating (setting off by default, private-room privacy guard) and the receive-side
// read-back (getImageSourcePackRefs), which FindPackDialog and ReactionsDialog's own "Find Pack"
// button both depend on.
describe("imageSourcePacks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("buildImageSourcePacks", () => {
        function publicRoom(): Room {
            const room = mkStubRoom("!room:example.org", "Test Room", undefined);
            room.getJoinRule = vi.fn().mockReturnValue(JoinRule.Public);
            return room;
        }

        it("returns an empty object when the setting is off (the default)", () => {
            SettingsStoreMock.getValue.mockReturnValue(false);
            const result = buildImageSourcePacks("mxc://example.org/abc", publicRoom(), "pack1", "wave");
            expect(result).toEqual({});
        });

        it("returns an empty object for a non-public, non-knockable room even with the setting on", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const room = mkStubRoom("!room:example.org", "Test Room", undefined);
            room.getJoinRule = vi.fn().mockReturnValue(JoinRule.Invite);
            const result = buildImageSourcePacks("mxc://example.org/abc", room, "pack1", "wave");
            expect(result).toEqual({});
        });

        it("includes a Knock room, not just Public, once the setting is on", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const room = mkStubRoom("!room:example.org", "Test Room", undefined);
            room.getJoinRule = vi.fn().mockReturnValue(JoinRule.Knock);
            const result = buildImageSourcePacks("mxc://example.org/abc", room, "pack1", "wave");
            expect(Object.keys(result)).toEqual(["mxc://example.org/abc"]);
        });

        it("builds the full ref keyed by mxcUrl when the setting is on and the room qualifies", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const result = buildImageSourcePacks("mxc://example.org/abc", publicRoom(), "pack1", "wave");
            expect(result).toEqual({
                "mxc://example.org/abc": {
                    room_id: "!room:example.org",
                    via: ["example.org"],
                    state_key: "pack1",
                    shortcode: "wave",
                },
            });
        });
    });

    describe("buildImageSourcePacksFromModel", () => {
        function makeClient(rooms: Record<string, Room>): MatrixClient {
            return {
                getRoom: vi.fn((roomId: string) => rooms[roomId]),
            } as unknown as MatrixClient;
        }

        function makeCustomEmojiPart(overrides: Partial<Part> = {}): Part {
            return {
                text: ":wave:",
                type: Type.CustomEmoji,
                mxcUrl: "mxc://example.org/abc",
                packName: "Greetings",
                roomId: "!room:example.org",
                stateKey: "pack1",
                canEdit: false,
                acceptsCaret: false,
                ...overrides,
            } as unknown as Part;
        }

        it("skips parts that aren't CustomEmoji", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const model = { parts: [{ type: Type.Plain, text: "hello" }] } as unknown as EditorModel;
            const result = buildImageSourcePacksFromModel(model, makeClient({}));
            expect(result).toEqual({});
        });

        it("skips a CustomEmoji part whose source room isn't one the client knows about", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const model = { parts: [makeCustomEmojiPart()] } as unknown as EditorModel;
            const result = buildImageSourcePacksFromModel(model, makeClient({}));
            expect(result).toEqual({});
        });

        it("strips the leading/trailing colons off the part's text to recover the shortcode", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const room = mkStubRoom("!room:example.org", "Test Room", undefined);
            room.getJoinRule = vi.fn().mockReturnValue(JoinRule.Public);
            const model = { parts: [makeCustomEmojiPart({ text: ":wave:" } as Partial<Part>)] } as unknown as EditorModel;
            const result = buildImageSourcePacksFromModel(model, makeClient({ "!room:example.org": room }));
            expect(result["mxc://example.org/abc"]?.shortcode).toBe("wave");
        });

        it("combines refs from multiple CustomEmoji parts, resolving each against its own source room", () => {
            SettingsStoreMock.getValue.mockReturnValue(true);
            const roomA = mkStubRoom("!a:example.org", "A", undefined);
            roomA.getJoinRule = vi.fn().mockReturnValue(JoinRule.Public);
            const roomB = mkStubRoom("!b:example.org", "B", undefined);
            roomB.getJoinRule = vi.fn().mockReturnValue(JoinRule.Public);

            const model = {
                parts: [
                    makeCustomEmojiPart({
                        text: ":wave:",
                        mxcUrl: "mxc://example.org/1",
                        roomId: "!a:example.org",
                        stateKey: "pack-a",
                    } as Partial<Part>),
                    makeCustomEmojiPart({
                        text: ":party:",
                        mxcUrl: "mxc://example.org/2",
                        roomId: "!b:example.org",
                        stateKey: "pack-b",
                    } as Partial<Part>),
                ],
            } as unknown as EditorModel;

            const result = buildImageSourcePacksFromModel(
                model,
                makeClient({ "!a:example.org": roomA, "!b:example.org": roomB }),
            );
            expect(Object.keys(result).sort()).toEqual(["mxc://example.org/1", "mxc://example.org/2"]);
            expect(result["mxc://example.org/1"]?.state_key).toBe("pack-a");
            expect(result["mxc://example.org/2"]?.state_key).toBe("pack-b");
        });
    });

    describe("getImageSourcePackRefs", () => {
        function eventWithContent(content: object): MatrixEvent {
            return mkEvent({ event: true, type: "m.room.message", user: "@a:x", room: "!r:x", content });
        }

        it("returns an empty array when the event carries no image_source_packs field", () => {
            expect(getImageSourcePackRefs(eventWithContent({ body: "hi" }))).toEqual([]);
        });

        it("returns an empty array when the field isn't an object", () => {
            expect(getImageSourcePackRefs(eventWithContent({ [IMAGE_SOURCE_PACKS_KEY]: "not-an-object" }))).toEqual([]);
        });

        it("returns every ref in the map, regardless of which mxcUrl key it's under", () => {
            const refA = { room_id: "!a:x", state_key: "pa", shortcode: "wave" };
            const refB = { room_id: "!b:x", state_key: "pb", shortcode: "party" };
            const event = eventWithContent({
                [IMAGE_SOURCE_PACKS_KEY]: {
                    "mxc://example.org/1": refA,
                    "mxc://example.org/2": refB,
                },
            });
            expect(getImageSourcePackRefs(event)).toEqual(expect.arrayContaining([refA, refB]));
            expect(getImageSourcePackRefs(event)).toHaveLength(2);
        });

        it("works the same for a reaction event's own content, not just a message/sticker", () => {
            const ref = { room_id: "!a:x", state_key: "pa", shortcode: "ok" };
            const event = eventWithContent({
                "m.relates_to": { rel_type: "m.annotation", event_id: "$1", key: "mxc://example.org/ok" },
                [IMAGE_SOURCE_PACKS_KEY]: { "mxc://example.org/ok": ref },
            });
            expect(getImageSourcePackRefs(event)).toEqual([ref]);
        });
    });
});
