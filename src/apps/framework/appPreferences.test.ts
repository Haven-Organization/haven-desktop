// @vitest-environment happy-dom
// Haven: the user's own choices about their apps (Settings > Apps) - turning apps off, hiding
// single apps - and the confirmation for removing an app they added from a room.
import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientEvent, type MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";

const { peg } = vi.hoisted(() => ({ peg: { client: null as unknown } }));
vi.mock("../../../element-web/apps/web/src/MatrixClientPeg", () => ({ MatrixClientPeg: { get: () => peg.client } }));
// A host config allowing everything.
vi.mock("./config", () => ({ isAppEnabled: () => true }));

import {
    APP_PREFERENCES_EVENT_TYPE,
    getAppPreferences,
    isAppShownByUser,
    setAppHidden,
    setAppsDisabled,
} from "./appPreferences";
import { getAllApps, getLaunchableApps } from "./registry";
import { removeFromAppsDescription, getRemovableAppKind } from "./removeFromApps";
import { WIDGET_APPS_EVENT_TYPE, widgetAppId } from "./widgetApps/widgetApps";
import { GAME_APPS_EVENT_TYPE, gameAppId } from "./gameApps/gameApps";

/** A client whose account data writes echo straight back, as the homeserver's would. */
function makeClient(): MatrixClient {
    const emitter = new EventEmitter();
    const accountData = new Map<string, MatrixEvent>();
    return Object.assign(emitter, {
        getUserId: () => "@me:example.org",
        getRoom: () => null,
        getAccountData: (type: string) => accountData.get(type),
        setAccountData: async (type: string, content: object) => {
            const ev = new MatrixEvent({ type, content });
            accountData.set(type, ev);
            emitter.emit(ClientEvent.AccountData, ev);
            return {};
        },
    }) as unknown as MatrixClient;
}

const WIDGET = {
    room_id: "!games:example.org",
    widget_id: "nostr-games",
    room_name: "Nostr Games",
    state_types: ["im.vector.modular.widgets"],
    content: { type: "m.custom", url: "https://bridge.example.org/", name: "Game hub" },
    sender: "@bridge:example.org",
};
const GAME = {
    room_id: "!fun:example.org",
    event_id: "$shared",
    game_id: "abc",
    name: "Chess",
    room_name: "Fun room",
};

describe("app preferences", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = makeClient();
        peg.client = client;
    });

    it("shows everything until the user says otherwise", () => {
        expect(getAppPreferences(client)).toEqual({ disabled: false, hidden: [] });
        expect(isAppShownByUser(client, "social")).toBe(true);
    });

    it("hides and shows single apps", async () => {
        await setAppHidden(client, "social", true);
        expect(isAppShownByUser(client, "social")).toBe(false);
        await setAppHidden(client, "social", false);
        expect(isAppShownByUser(client, "social")).toBe(true);
    });

    it("turning apps off hides every app, and keeps which ones were hidden", async () => {
        await setAppHidden(client, "social", true);
        await setAppsDisabled(client, true);
        expect(isAppShownByUser(client, "other")).toBe(false);
        await setAppsDisabled(client, false);
        expect(getAppPreferences(client)).toEqual({ disabled: false, hidden: ["social"] });
    });

    it("keeps fields it doesn't know about", async () => {
        await client.setAccountData(APP_PREFERENCES_EVENT_TYPE as never, { future: 1 } as never);
        await setAppsDisabled(client, true);
        expect(client.getAccountData(APP_PREFERENCES_EVENT_TYPE as never)?.getContent()).toEqual({
            future: 1,
            disabled: true,
            hidden: [],
        });
    });

    describe("in the registry", () => {
        beforeEach(async () => {
            await client.setAccountData(WIDGET_APPS_EVENT_TYPE as never, { widgets: [WIDGET] } as never);
            await client.setAccountData(GAME_APPS_EVENT_TYPE as never, { games: [GAME] } as never);
        });

        const ids = (apps: { id: string }[]): string[] => apps.map((a) => a.id);
        const widgetId = widgetAppId(WIDGET.room_id, WIDGET.widget_id);
        const gameId = gameAppId(GAME.room_id, GAME.event_id);

        it("lists built-in apps, widgets and games", () => {
            expect(ids(getLaunchableApps())).toEqual(["social", widgetId, gameId]);
        });

        it("leaves hidden apps out of what can be launched, but not out of Settings", async () => {
            await setAppHidden(client, widgetId, true);
            expect(ids(getLaunchableApps())).toEqual(["social", gameId]);
            expect(ids(getAllApps())).toEqual(["social", widgetId, gameId]);
        });

        it("launches nothing while apps are turned off", async () => {
            await setAppsDisabled(client, true);
            expect(getLaunchableApps()).toEqual([]);
            expect(getAllApps()).toHaveLength(3);
        });

        it("says where a removed app stays available", () => {
            expect(getRemovableAppKind(client, "social")).toBeUndefined();
            expect(removeFromAppsDescription(client, "social", "Social")).toBeUndefined();
            expect(removeFromAppsDescription(client, widgetId, "Game hub")).toContain("in Nostr Games's extensions");
            expect(removeFromAppsDescription(client, gameId, "Chess")).toContain(
                "in the message it was shared in, in Fun room",
            );
        });
    });
});
