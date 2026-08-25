// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { EventType, MsgType, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import {
    ROOM_IMAGE_PACK_EVENT,
    IMAGE_PACK_ROOMS_EVENT,
    getRoomImagePacks,
    getRoomImagePacksForManagement,
    packDisplayName,
    effectiveImageUsage,
    packHasUsage,
    imagesForUsage,
    canManageImagePacks,
    newPackStateKey,
    getFavoritePackRefs,
    getFavoritePacks,
    isPackFavorited,
    getEmoticonPacks,
    getAllJoinedRoomPacks,
    sanitizeShortcode,
    shortcodeFromMxcUrl,
    getPackAvatarMxc,
    getPackableImageFromEvent,
    getManageableImagePacks,
    addImageToExistingPack,
    type ImagePackContent,
    type RoomImagePack,
} from "./ImagePacks";
import { mkStubRoom, mkEvent } from "../../test/test-utils/test-utils";

// Haven: MSC2545 (Image Packs) core data layer - regression coverage for the parts most likely to
// silently break during an upstream merge conflict: the stable/unstable event-type merge (stable
// always wins), the "deleted pack" convention (empty images:{} = gone), usage-override precedence,
// the favorite-packs union-of-both-blobs read + write-both-blobs-identically write, and the
// state_key/shortcode collision-avoidance helpers.

function stateEvent(type: string, stateKey: string, content: object): ReturnType<typeof mkEvent> {
    return mkEvent({ event: true, type, skey: stateKey, user: "@a:example.org", room: "!r:example.org", content });
}

function roomWithPackEvents(events: ReturnType<typeof mkEvent>[]): Room {
    const room = mkStubRoom("!r:example.org", "Test Room", undefined);
    room.currentState.getStateEvents = vi.fn((type: string, key?: string) => {
        const matches = events.filter((e) => e.getType() === type);
        if (key === undefined) return matches;
        return matches.find((e) => e.getStateKey() === key) ?? null;
    }) as unknown as Room["currentState"]["getStateEvents"];
    return room;
}

describe("ImagePacks", () => {
    describe("getRoomImagePacksForManagement / getRoomImagePacks (stable/unstable merge)", () => {
        it("reads a pack under the stable event type", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", {
                    images: { wave: { url: "mxc://x/1" } },
                }),
            ]);
            const packs = getRoomImagePacks(room);
            expect(packs).toHaveLength(1);
            expect(packs[0].stateKey).toBe("pack1");
        });

        it("also reads a pack under the old unstable event type", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.altName!, "pack1", {
                    images: { wave: { url: "mxc://x/1" } },
                }),
            ]);
            const packs = getRoomImagePacks(room);
            expect(packs).toHaveLength(1);
        });

        it("the stable event wins over an unstable one with the same state_key", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.altName!, "pack1", { images: { old: { url: "mxc://x/old" } } }),
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", { images: { fresh: { url: "mxc://x/fresh" } } }),
            ]);
            const packs = getRoomImagePacks(room);
            expect(packs).toHaveLength(1);
            expect(Object.keys(packs[0].content.images)).toEqual(["fresh"]);
        });

        it("getRoomImagePacks hides a pack that's been emptied out (the 'deleted' convention)", () => {
            const room = roomWithPackEvents([stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", { images: {} })]);
            expect(getRoomImagePacks(room)).toEqual([]);
        });

        it("getRoomImagePacksForManagement still shows an emptied pack if it kept its pack metadata", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", { pack: { display_name: "Empty Pack" }, images: {} }),
            ]);
            expect(getRoomImagePacksForManagement(room)).toHaveLength(1);
            expect(getRoomImagePacks(room)).toEqual([]);
        });

        it("getRoomImagePacksForManagement hides a pack with neither metadata nor images (genuinely gone)", () => {
            const room = roomWithPackEvents([stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", { images: {} })]);
            expect(getRoomImagePacksForManagement(room)).toEqual([]);
        });

        it("ignores state content that isn't image-pack shaped", () => {
            const room = roomWithPackEvents([stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pack1", { not_a_pack: true })]);
            expect(getRoomImagePacksForManagement(room)).toEqual([]);
        });
    });

    describe("packDisplayName", () => {
        it("uses the pack's own display_name when set", () => {
            expect(packDisplayName({ pack: { display_name: "My Pack" }, images: {} }, "fallback")).toBe("My Pack");
        });
        it("falls back when display_name is unset", () => {
            expect(packDisplayName({ images: {} }, "fallback")).toBe("fallback");
        });
        it("falls back when display_name is only whitespace", () => {
            expect(packDisplayName({ pack: { display_name: "   " }, images: {} }, "fallback")).toBe("fallback");
        });
    });

    describe("effectiveImageUsage / packHasUsage / imagesForUsage", () => {
        const packWithMixedUsage: ImagePackContent = {
            pack: { usage: ["sticker"] },
            images: {
                onlyEmoji: { url: "mxc://x/1", usage: ["emoticon"] },
                inheritsPack: { url: "mxc://x/2" },
            },
        };

        it("an image's own usage overrides the pack's default", () => {
            expect(effectiveImageUsage(packWithMixedUsage.images.onlyEmoji, packWithMixedUsage)).toEqual(["emoticon"]);
        });

        it("falls back to the pack's own default usage when the image has none", () => {
            expect(effectiveImageUsage(packWithMixedUsage.images.inheritsPack, packWithMixedUsage)).toEqual(["sticker"]);
        });

        it("defaults to both usages when neither the image nor the pack says anything", () => {
            expect(effectiveImageUsage({ url: "mxc://x/3" }, { images: {} })).toEqual(["emoticon", "sticker"]);
        });

        it("packHasUsage finds a pack usable for a usage via any one of its images", () => {
            expect(packHasUsage(packWithMixedUsage, "emoticon")).toBe(true);
            expect(packHasUsage(packWithMixedUsage, "sticker")).toBe(true);
            expect(packHasUsage({ images: { a: { url: "mxc://x/1", usage: ["sticker"] } } }, "emoticon")).toBe(false);
        });

        it("imagesForUsage filters to just the images usable for that usage, with their shortcodes", () => {
            const pack: RoomImagePack = { roomId: "!r:x", stateKey: "p1", content: packWithMixedUsage };
            // onlyEmoji explicitly overrides to ["emoticon"] only; inheritsPack has no override of
            // its own, so it inherits the pack's default of ["sticker"] and is excluded here.
            expect(imagesForUsage(pack, "emoticon").map((e) => e.shortcode)).toEqual(["onlyEmoji"]);
            expect(imagesForUsage(pack, "sticker").map((e) => e.shortcode)).toEqual(["inheritsPack"]);
        });
    });

    describe("canManageImagePacks", () => {
        it("delegates to the room's own maySendStateEvent for the stable event type", () => {
            const room = mkStubRoom("!r:x", "Room", undefined);
            room.currentState.maySendStateEvent = vi.fn().mockReturnValue(true);
            expect(canManageImagePacks(room, "@a:x")).toBe(true);
            expect(room.currentState.maySendStateEvent).toHaveBeenCalledWith(ROOM_IMAGE_PACK_EVENT.name, "@a:x");
        });

        it("returns false when the room says no", () => {
            const room = mkStubRoom("!r:x", "Room", undefined);
            room.currentState.maySendStateEvent = vi.fn().mockReturnValue(false);
            expect(canManageImagePacks(room, "@a:x")).toBe(false);
        });
    });

    describe("newPackStateKey", () => {
        it("slugifies the name for a room with no existing packs", () => {
            const room = roomWithPackEvents([]);
            expect(newPackStateKey(room, "My Cool Pack!")).toBe("my-cool-pack");
        });

        it("falls back to 'pack' when the name slugifies to nothing", () => {
            const room = roomWithPackEvents([]);
            expect(newPackStateKey(room, "!!!")).toBe("pack");
        });

        it("appends -2, -3, ... when the base slug is already taken", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "my-pack", { images: { a: { url: "mxc://x/1" } } }),
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "my-pack-2", { images: { a: { url: "mxc://x/1" } } }),
            ]);
            expect(newPackStateKey(room, "My Pack")).toBe("my-pack-3");
        });

        it("checks against management-visible packs (still-empty ones with metadata count as taken)", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "my-pack", { pack: { display_name: "x" }, images: {} }),
            ]);
            expect(newPackStateKey(room, "My Pack")).toBe("my-pack-2");
        });
    });

    describe("favorite packs (account data)", () => {
        function clientWithAccountData(stable?: object, unstable?: object): MatrixClient {
            const data: Record<string, { getContent(): object }> = {};
            if (stable) data[IMAGE_PACK_ROOMS_EVENT.name] = { getContent: () => stable };
            if (unstable) data[IMAGE_PACK_ROOMS_EVENT.altName!] = { getContent: () => unstable };
            return { getAccountData: vi.fn((type: string) => data[type]) } as unknown as MatrixClient;
        }

        it("getFavoritePackRefs reads refs from the stable blob", () => {
            const client = clientWithAccountData({ rooms: { "!r:x": { pack1: {} } } });
            expect(getFavoritePackRefs(client)).toEqual([{ roomId: "!r:x", stateKey: "pack1" }]);
        });

        it("getFavoritePackRefs unions the stable and unstable blobs rather than picking one", () => {
            const client = clientWithAccountData({ rooms: { "!a:x": { p1: {} } } }, { rooms: { "!b:x": { p2: {} } } });
            const refs = getFavoritePackRefs(client);
            expect(refs).toEqual(
                expect.arrayContaining([
                    { roomId: "!a:x", stateKey: "p1" },
                    { roomId: "!b:x", stateKey: "p2" },
                ]),
            );
            expect(refs).toHaveLength(2);
        });

        it("getFavoritePackRefs merges state_keys within the same room from both blobs", () => {
            const client = clientWithAccountData({ rooms: { "!a:x": { p1: {} } } }, { rooms: { "!a:x": { p2: {} } } });
            const refs = getFavoritePackRefs(client);
            expect(refs.map((r) => r.stateKey).sort()).toEqual(["p1", "p2"]);
        });

        it("isPackFavorited is true only for a ref actually present in the merged set", () => {
            const client = clientWithAccountData({ rooms: { "!a:x": { p1: {} } } });
            expect(isPackFavorited(client, "!a:x", "p1")).toBe(true);
            expect(isPackFavorited(client, "!a:x", "p2")).toBe(false);
            expect(isPackFavorited(client, "!b:x", "p1")).toBe(false);
        });

        it("getFavoritePacks silently drops a ref to a room the user has since left", () => {
            const client = clientWithAccountData({ rooms: { "!gone:x": { p1: {} } } });
            client.getRoom = vi.fn().mockReturnValue(null);
            expect(getFavoritePacks(client)).toEqual([]);
        });

        it("getFavoritePacks silently drops a ref whose pack was since deleted (emptied)", () => {
            const client = clientWithAccountData({ rooms: { "!r:x": { p1: {} } } });
            const room = roomWithPackEvents([stateEvent(ROOM_IMAGE_PACK_EVENT.name, "p1", { images: {} })]);
            client.getRoom = vi.fn().mockReturnValue(room);
            expect(getFavoritePacks(client)).toEqual([]);
        });

        it("getFavoritePacks resolves a live ref to its real pack content", () => {
            const client = clientWithAccountData({ rooms: { "!r:x": { p1: {} } } });
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "p1", { images: { wave: { url: "mxc://x/1" } } }),
            ]);
            client.getRoom = vi.fn().mockReturnValue(room);
            const packs = getFavoritePacks(client);
            expect(packs).toHaveLength(1);
            expect(packs[0].stateKey).toBe("p1");
        });
    });

    describe("setFavoritePackRefs (write path)", () => {
        it("writes the identical rooms map to both the stable and unstable event types", async () => {
            const setAccountData = vi.fn().mockResolvedValue(undefined);
            const client = { setAccountData } as unknown as MatrixClient;
            const { setFavoritePackRefs } = await import("./ImagePacks");
            await setFavoritePackRefs(client, [{ roomId: "!r:x", stateKey: "p1" }]);

            expect(setAccountData).toHaveBeenCalledTimes(2);
            const calledTypes = setAccountData.mock.calls.map((c) => c[0]).sort();
            expect(calledTypes).toEqual([IMAGE_PACK_ROOMS_EVENT.altName, IMAGE_PACK_ROOMS_EVENT.name].sort());
            const [, contentA] = setAccountData.mock.calls[0];
            const [, contentB] = setAccountData.mock.calls[1];
            expect(contentA).toEqual(contentB);
            expect(contentA).toEqual({ rooms: { "!r:x": { p1: {} } } });
        });

        it("an empty refs list writes an empty rooms map (used to fully unfavorite)", async () => {
            const setAccountData = vi.fn().mockResolvedValue(undefined);
            const client = { setAccountData } as unknown as MatrixClient;
            await (await import("./ImagePacks")).setFavoritePackRefs(client, []);
            expect(setAccountData).toHaveBeenCalledWith(expect.any(String), { rooms: {} });
        });
    });

    describe("getEmoticonPacks", () => {
        it("combines this room's own packs with the user's favorites, filtered by usage", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "own-pack", {
                    images: { wave: { url: "mxc://x/1", usage: ["emoticon"] } },
                }),
            ]);
            const favoriteRoom = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "fav-pack", {
                    images: { party: { url: "mxc://x/2", usage: ["emoticon"] } },
                }),
            ]);
            const client = {
                getAccountData: vi.fn((type: string) =>
                    type === IMAGE_PACK_ROOMS_EVENT.name ? { getContent: () => ({ rooms: { "!fav:x": { "fav-pack": {} } } }) } : undefined,
                ),
                getRoom: vi.fn().mockReturnValue(favoriteRoom),
            } as unknown as MatrixClient;
            (room as unknown as { client: MatrixClient }).client = client;

            const packs = getEmoticonPacks(room, "emoticon");
            expect(packs.map((p) => p.stateKey).sort()).toEqual(["fav-pack", "own-pack"]);
        });

        it("doesn't double up a favorited pack that's also this room's own", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "shared-pack", { images: { a: { url: "mxc://x/1" } } }),
            ]);
            const client = {
                getAccountData: vi.fn((type: string) =>
                    type === IMAGE_PACK_ROOMS_EVENT.name
                        ? { getContent: () => ({ rooms: { "!r:example.org": { "shared-pack": {} } } }) }
                        : undefined,
                ),
                getRoom: vi.fn().mockReturnValue(room),
            } as unknown as MatrixClient;
            (room as unknown as { client: MatrixClient }).client = client;

            const packs = getEmoticonPacks(room, "emoticon");
            expect(packs).toHaveLength(1);
        });

        it("excludes a room/favorite pack that doesn't have the requested usage", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "sticker-only", {
                    images: { a: { url: "mxc://x/1", usage: ["sticker"] } },
                }),
            ]);
            const client = { getAccountData: vi.fn().mockReturnValue(undefined) } as unknown as MatrixClient;
            (room as unknown as { client: MatrixClient }).client = client;
            expect(getEmoticonPacks(room, "emoticon")).toEqual([]);
        });
    });

    describe("getAllJoinedRoomPacks", () => {
        it("flattens getRoomImagePacks across every joined room", () => {
            const roomA = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pa", { images: { a: { url: "mxc://x/1" } } }),
            ]);
            const roomB = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pb", { images: { b: { url: "mxc://x/2" } } }),
            ]);
            const client = { getRooms: vi.fn().mockReturnValue([roomA, roomB]) } as unknown as MatrixClient;
            expect(getAllJoinedRoomPacks(client).map((p) => p.stateKey).sort()).toEqual(["pa", "pb"]);
        });
    });

    describe("sanitizeShortcode / shortcodeFromMxcUrl", () => {
        it("strips a trailing file extension", () => {
            expect(sanitizeShortcode("party-parrot.gif")).toBe("party-parrot");
        });
        it("replaces disallowed characters with underscores", () => {
            expect(sanitizeShortcode("my cool emoji!!")).toBe("my_cool_emoji_");
        });
        it("falls back to 'image' for an empty/unsanitizable input", () => {
            expect(sanitizeShortcode("")).toBe("image");
            expect(sanitizeShortcode(".gif")).toBe("image");
        });
        it("derives a shortcode from the last path segment of an mxc:// URL", () => {
            expect(shortcodeFromMxcUrl("mxc://example.org/AbC123")).toBe("AbC123");
        });
    });

    describe("getPackAvatarMxc", () => {
        it("prefers the pack's own explicit avatar_url", () => {
            const pack: RoomImagePack = {
                roomId: "!r:x",
                stateKey: "p",
                content: { pack: { avatar_url: "mxc://x/avatar" }, images: { a: { url: "mxc://x/img" } } },
            };
            const client = { getRoom: vi.fn() } as unknown as MatrixClient;
            expect(getPackAvatarMxc(pack, client)).toBe("mxc://x/avatar");
        });

        it("falls back to the pack's first image when no explicit avatar is set", () => {
            const pack: RoomImagePack = {
                roomId: "!r:x",
                stateKey: "p",
                content: { images: { a: { url: "mxc://x/img" } } },
            };
            const client = { getRoom: vi.fn() } as unknown as MatrixClient;
            expect(getPackAvatarMxc(pack, client)).toBe("mxc://x/img");
        });

        it("falls back to the source room's own avatar only as a last resort", () => {
            const pack: RoomImagePack = { roomId: "!r:x", stateKey: "p", content: { images: {} } };
            const room = { getMxcAvatarUrl: vi.fn().mockReturnValue("mxc://x/room-avatar") } as unknown as Room;
            const client = { getRoom: vi.fn().mockReturnValue(room) } as unknown as MatrixClient;
            expect(getPackAvatarMxc(pack, client)).toBe("mxc://x/room-avatar");
        });

        it("returns undefined when there's truly nothing to fall back to", () => {
            const pack: RoomImagePack = { roomId: "!r:x", stateKey: "p", content: { images: {} } };
            const client = { getRoom: vi.fn().mockReturnValue(undefined) } as unknown as MatrixClient;
            expect(getPackAvatarMxc(pack, client)).toBeUndefined();
        });
    });

    describe("getPackableImageFromEvent", () => {
        it("accepts a sticker event with a plain url", () => {
            const event = mkEvent({
                event: true,
                type: EventType.Sticker,
                user: "@a:x",
                room: "!r:x",
                content: { url: "mxc://x/sticker", body: "a sticker" },
            });
            expect(getPackableImageFromEvent(event)).toEqual({ mxcUrl: "mxc://x/sticker", body: "a sticker" });
        });

        it("accepts an m.image room message with a plain url", () => {
            const event = mkEvent({
                event: true,
                type: EventType.RoomMessage,
                user: "@a:x",
                room: "!r:x",
                content: { msgtype: MsgType.Image, url: "mxc://x/img", body: "an image" },
            });
            expect(getPackableImageFromEvent(event)?.mxcUrl).toBe("mxc://x/img");
        });

        it("rejects a non-image room message", () => {
            const event = mkEvent({
                event: true,
                type: EventType.RoomMessage,
                user: "@a:x",
                room: "!r:x",
                content: { msgtype: MsgType.Text, body: "hi" },
            });
            expect(getPackableImageFromEvent(event)).toBeUndefined();
        });

        it("rejects an encrypted image (content.file, not a plain content.url)", () => {
            const event = mkEvent({
                event: true,
                type: EventType.RoomMessage,
                user: "@a:x",
                room: "!r:x",
                content: { msgtype: MsgType.Image, file: { url: "mxc://x/enc" }, body: "an image" },
            });
            expect(getPackableImageFromEvent(event)).toBeUndefined();
        });
    });

    describe("getManageableImagePacks", () => {
        it("only includes rooms the user can manage packs in", () => {
            const manageable = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pa", { images: { a: { url: "mxc://x/1" } } }),
            ]);
            manageable.currentState.maySendStateEvent = vi.fn().mockReturnValue(true);
            const notManageable = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "pb", { images: { a: { url: "mxc://x/1" } } }),
            ]);
            notManageable.currentState.maySendStateEvent = vi.fn().mockReturnValue(false);

            const client = {
                getSafeUserId: vi.fn().mockReturnValue("@a:x"),
                getRooms: vi.fn().mockReturnValue([manageable, notManageable]),
            } as unknown as MatrixClient;
            const packs = getManageableImagePacks(client);
            expect(packs.map((p) => p.stateKey)).toEqual(["pa"]);
        });

        it("includes a still-empty pack the user can manage (for-management view)", () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "empty", { pack: { display_name: "New" }, images: {} }),
            ]);
            room.currentState.maySendStateEvent = vi.fn().mockReturnValue(true);
            const client = {
                getSafeUserId: vi.fn().mockReturnValue("@a:x"),
                getRooms: vi.fn().mockReturnValue([room]),
            } as unknown as MatrixClient;
            expect(getManageableImagePacks(client).map((p) => p.stateKey)).toEqual(["empty"]);
        });
    });

    describe("addImageToExistingPack", () => {
        it("throws when the room isn't joined", async () => {
            const client = { getRoom: vi.fn().mockReturnValue(undefined) } as unknown as MatrixClient;
            await expect(
                addImageToExistingPack(client, "!gone:x", "p1", { shortcodeHint: "wave", url: "mxc://x/1" }),
            ).rejects.toThrow("You're not in that pack's room");
        });

        it("throws when the pack no longer exists", async () => {
            const room = roomWithPackEvents([]);
            const client = { getRoom: vi.fn().mockReturnValue(room) } as unknown as MatrixClient;
            await expect(
                addImageToExistingPack(client, "!r:x", "gone-pack", { shortcodeHint: "wave", url: "mxc://x/1" }),
            ).rejects.toThrow("That pack no longer exists");
        });

        it("adds the image under a sanitized shortcode and copies the pack's default usage", async () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "p1", { pack: { usage: ["sticker"] }, images: {} }),
            ]);
            const sendStateEvent = vi.fn().mockResolvedValue(undefined);
            const client = { getRoom: vi.fn().mockReturnValue(room), sendStateEvent } as unknown as MatrixClient;

            await addImageToExistingPack(client, "!r:example.org", "p1", {
                shortcodeHint: "party parrot!.gif",
                url: "mxc://x/new",
            });

            expect(sendStateEvent).toHaveBeenCalledTimes(1);
            const [, , content, stateKey] = sendStateEvent.mock.calls[0];
            expect(stateKey).toBe("p1");
            expect(content.images).toHaveProperty("party_parrot_");
            expect(content.images.party_parrot_.usage).toEqual(["sticker"]);
        });

        it("de-duplicates the shortcode if one with that name already exists in the pack", async () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "p1", { images: { wave: { url: "mxc://x/old" } } }),
            ]);
            const sendStateEvent = vi.fn().mockResolvedValue(undefined);
            const client = { getRoom: vi.fn().mockReturnValue(room), sendStateEvent } as unknown as MatrixClient;

            await addImageToExistingPack(client, "!r:example.org", "p1", { shortcodeHint: "wave", url: "mxc://x/new" });

            const [, , content] = sendStateEvent.mock.calls[0];
            expect(Object.keys(content.images).sort()).toEqual(["wave", "wave-2"]);
            expect(content.images["wave-2"].url).toBe("mxc://x/new");
        });

        it("preserves the pack's existing images and metadata rather than replacing them", async () => {
            const room = roomWithPackEvents([
                stateEvent(ROOM_IMAGE_PACK_EVENT.name, "p1", {
                    pack: { display_name: "Keep Me" },
                    images: { existing: { url: "mxc://x/existing" } },
                }),
            ]);
            const sendStateEvent = vi.fn().mockResolvedValue(undefined);
            const client = { getRoom: vi.fn().mockReturnValue(room), sendStateEvent } as unknown as MatrixClient;

            await addImageToExistingPack(client, "!r:example.org", "p1", { shortcodeHint: "new", url: "mxc://x/new" });

            const [, , content] = sendStateEvent.mock.calls[0];
            expect(content.pack).toEqual({ display_name: "Keep Me" });
            expect(content.images.existing.url).toBe("mxc://x/existing");
            expect(content.images.new.url).toBe("mxc://x/new");
        });
    });
});
