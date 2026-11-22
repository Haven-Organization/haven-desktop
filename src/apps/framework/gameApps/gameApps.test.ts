// @vitest-environment happy-dom
// Haven: games added to the user's apps - the stored links, adding, updating and removing them.
import { EventEmitter } from "events";
import { describe, it, expect } from "vitest";
import { ClientEvent, type MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";

import { PINNED_APPS_EVENT_TYPE } from "../pinnedApps";
import {
    addGameApp,
    findGameAppEntryByAppId,
    GAME_APPS_EVENT_TYPE,
    gameAppId,
    getGameAppEntries,
    removeGameApp,
    updateGameAppEntry,
    type GameAppEntry,
} from "./gameApps";

const ROOM_ID = "!room:example.org";
const EVENT_ID = "$game";
const ENTRY: GameAppEntry = {
    room_id: ROOM_ID,
    event_id: EVENT_ID,
    game_id: "abc123",
    name: "Toss the Turtle",
    icon: "data:image/png;base64,AAAA",
    room_name: "Games",
};

/** A client whose account data writes echo straight back, as the homeserver's would. */
function makeClient(): MatrixClient {
    const emitter = new EventEmitter();
    const accountData = new Map<string, MatrixEvent>();
    return Object.assign(emitter, {
        getUserId: () => "@me:example.org",
        getAccountData: (type: string) => accountData.get(type),
        setAccountData: async (type: string, content: object) => {
            const ev = new MatrixEvent({ type, content });
            accountData.set(type, ev);
            emitter.emit(ClientEvent.AccountData, ev);
            return {};
        },
    }) as unknown as MatrixClient;
}

const pinned = (client: MatrixClient): string[] =>
    client.getAccountData(PINNED_APPS_EVENT_TYPE as never)?.getContent()?.pinned ?? [];

describe("game apps", () => {
    it("stores a link to the game's message and pins it", async () => {
        const client = makeClient();
        await addGameApp(client, ENTRY);
        expect(getGameAppEntries(client)).toEqual([ENTRY]);
        expect(pinned(client)).toEqual([gameAppId(ROOM_ID, EVENT_ID)]);
        expect(findGameAppEntryByAppId(client, gameAppId(ROOM_ID, EVENT_ID))).toEqual(ENTRY);
    });

    it("doesn't add the same game twice", async () => {
        const client = makeClient();
        await addGameApp(client, ENTRY);
        await addGameApp(client, { ...ENTRY, name: "Renamed" });
        expect(getGameAppEntries(client)).toEqual([{ ...ENTRY, name: "Renamed" }]);
    });

    it("updates what's stored", async () => {
        const client = makeClient();
        await addGameApp(client, { ...ENTRY, icon: undefined });
        await updateGameAppEntry(client, ENTRY);
        expect(getGameAppEntries(client)[0].icon).toBe(ENTRY.icon);
    });

    it("removes the link and its pin", async () => {
        const client = makeClient();
        await addGameApp(client, ENTRY);
        await removeGameApp(client, ROOM_ID, EVENT_ID);
        expect(getGameAppEntries(client)).toEqual([]);
        expect(pinned(client)).toEqual([]);
    });

    it("ignores stored entries that aren't game links, or whose icon isn't an image", async () => {
        const client = makeClient();
        await (client as unknown as { setAccountData(t: string, c: object): Promise<unknown> }).setAccountData(
            GAME_APPS_EVENT_TYPE,
            {
                games: [
                    ENTRY,
                    { room_id: ROOM_ID },
                    { ...ENTRY, event_id: "$other", icon: "https://example.org/x.png" },
                ],
            },
        );
        expect(getGameAppEntries(client)).toEqual([ENTRY]);
    });
});
