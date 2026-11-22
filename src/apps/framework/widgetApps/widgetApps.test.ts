// @vitest-environment happy-dom
// Haven: room widgets added to the user's apps - the stored links, adding and removing them,
// dropping the ones the user removed from the room themselves, and putting a removed one back.
import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientEvent, KnownMembership, type MatrixClient, MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { SettingLevel } from "../../../../element-web/apps/web/src/settings/SettingLevel";
import { PINNED_APPS_EVENT_TYPE } from "../pinnedApps";
import {
    addWidgetApp,
    canRecreateWidget,
    entryForCurrentWidget,
    getWidgetAppEntries,
    goToRoomLabel,
    LEGACY_WIDGET_TYPE,
    recreateWidget,
    removeWidgetApp,
    updateWidgetAppEntry,
    WIDGET_APPS_EVENT_TYPE,
    WIDGET_TYPE,
    widgetAppId,
    type WidgetAppEntry,
} from "./widgetApps";
import { findOwnRemovals, isOwnRemoval } from "./useWidgetAppsWatcher";
import { widgetAppConsentCarriesOver } from "./widgetConsent";

const ME = "@me:example.org";
const BRIDGE = "@bridge:example.org";
const ROOM_ID = "!room:example.org";
const WIDGET_ID = "nostr-games";
const CONTENT = {
    type: "m.custom",
    url: "https://bridge.example.org/xdc/hub?matrix_room_id=$matrix_room_id",
    name: "Nostr Games",
};

function stateEvent(type: string, content: object, sender = BRIDGE, id = "$widget"): MatrixEvent {
    return new MatrixEvent({ type, state_key: WIDGET_ID, content, sender, room_id: ROOM_ID, event_id: id });
}

interface FakeRoom {
    room: Room;
    state: Map<string, MatrixEvent>;
    canSend: Set<string>;
}

function makeRoom(membership: string = KnownMembership.Join): FakeRoom {
    const state = new Map<string, MatrixEvent>();
    const canSend = new Set<string>();
    const room = {
        roomId: ROOM_ID,
        name: "Games",
        getMyMembership: () => membership,
        currentState: {
            getStateEvents: (type: string, key: string) => state.get(`${type}|${key}`) ?? null,
            maySendStateEvent: (type: string) => canSend.has(type),
        },
    } as unknown as Room;
    return { room, state, canSend };
}

function setState(fake: FakeRoom, ev: MatrixEvent): void {
    fake.state.set(`${ev.getType()}|${ev.getStateKey()}`, ev);
}

/** A client whose account data writes echo straight back, as the homeserver's would. */
function makeClient(rooms: Room[] = []): MatrixClient & { sendStateEvent: ReturnType<typeof vi.fn> } {
    const emitter = new EventEmitter();
    const accountData = new Map<string, MatrixEvent>();
    const client = Object.assign(emitter, {
        getUserId: () => ME,
        getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
        getAccountData: (type: string) => accountData.get(type),
        setAccountData: async (type: string, content: object) => {
            const ev = new MatrixEvent({ type, content });
            accountData.set(type, ev);
            emitter.emit(ClientEvent.AccountData, ev);
            return {};
        },
        sendStateEvent: vi.fn().mockResolvedValue({ event_id: "$new" }),
    });
    return client as unknown as MatrixClient & { sendStateEvent: ReturnType<typeof vi.fn> };
}

const pinned = (client: MatrixClient): string[] =>
    client.getAccountData(PINNED_APPS_EVENT_TYPE as never)?.getContent()?.pinned ?? [];

describe("widget apps", () => {
    let fake: FakeRoom;
    let client: ReturnType<typeof makeClient>;
    let allowed: Record<string, boolean>;

    beforeEach(() => {
        vi.restoreAllMocks();
        fake = makeRoom();
        setState(fake, stateEvent(LEGACY_WIDGET_TYPE, CONTENT));
        setState(fake, stateEvent(WIDGET_TYPE, CONTENT));
        client = makeClient([fake.room]);
        allowed = {};
        vi.spyOn(SettingsStore, "getValue").mockImplementation((() => allowed) as never);
        vi.spyOn(SettingsStore, "firstSupportedLevel").mockReturnValue(SettingLevel.ROOM_ACCOUNT);
        vi.spyOn(SettingsStore, "setValue").mockImplementation((async (
            _name: string,
            _room: string,
            _level: SettingLevel,
            value: Record<string, boolean>,
        ) => {
            allowed = value;
        }) as never);
    });

    it("stores a link to the room's widget, with its content, and pins it", async () => {
        await addWidgetApp(client, fake.room, WIDGET_ID);

        expect(getWidgetAppEntries(client)).toEqual([
            {
                room_id: ROOM_ID,
                widget_id: WIDGET_ID,
                room_name: "Games",
                state_types: [LEGACY_WIDGET_TYPE, WIDGET_TYPE],
                content: CONTENT,
                sender: BRIDGE,
            },
        ]);
        expect(pinned(client)).toEqual([widgetAppId(ROOM_ID, WIDGET_ID)]);
    });

    it("counts adding a widget as allowing it to load", async () => {
        await addWidgetApp(client, fake.room, WIDGET_ID);
        expect(allowed).toEqual({ $widget: true });
    });

    it("only stores the state types the room actually has the widget under", () => {
        fake.state.delete(`${WIDGET_TYPE}|${WIDGET_ID}`);
        expect(entryForCurrentWidget(fake.room, WIDGET_ID)?.state_types).toEqual([LEGACY_WIDGET_TYPE]);
    });

    it("won't add a widget the room doesn't have", async () => {
        setState(fake, stateEvent(LEGACY_WIDGET_TYPE, {}));
        await expect(addWidgetApp(client, fake.room, WIDGET_ID)).rejects.toThrow();
        expect(getWidgetAppEntries(client)).toEqual([]);
    });

    it("removes the link and its pin", async () => {
        await addWidgetApp(client, fake.room, WIDGET_ID);
        await removeWidgetApp(client, ROOM_ID, WIDGET_ID);
        expect(getWidgetAppEntries(client)).toEqual([]);
        expect(pinned(client)).toEqual([]);
    });

    it("keeps the stored content up to date", async () => {
        await addWidgetApp(client, fake.room, WIDGET_ID);
        const newer = { ...CONTENT, url: "https://bridge.example.org/xdc/hub?game=chess" };
        setState(fake, stateEvent(LEGACY_WIDGET_TYPE, newer, BRIDGE, "$newer"));
        await updateWidgetAppEntry(client, entryForCurrentWidget(fake.room, WIDGET_ID)!);
        expect(getWidgetAppEntries(client)[0].content).toEqual(newer);
    });

    describe("putting a removed widget back", () => {
        let entry: WidgetAppEntry;

        beforeEach(async () => {
            await addWidgetApp(client, fake.room, WIDGET_ID);
            entry = getWidgetAppEntries(client)[0];
            setState(fake, stateEvent(LEGACY_WIDGET_TYPE, {}, "@mod:example.org", "$removed"));
            setState(fake, stateEvent(WIDGET_TYPE, {}, "@mod:example.org", "$removed2"));
        });

        it("writes the last content back under the same id and state types", async () => {
            await recreateWidget(client, entry);
            expect(client.sendStateEvent).toHaveBeenCalledTimes(2);
            expect(client.sendStateEvent).toHaveBeenCalledWith(ROOM_ID, LEGACY_WIDGET_TYPE, CONTENT, WIDGET_ID);
            expect(client.sendStateEvent).toHaveBeenCalledWith(ROOM_ID, WIDGET_TYPE, CONTENT, WIDGET_ID);
        });

        it("always writes the type Element reads", async () => {
            await recreateWidget(client, { ...entry, state_types: [WIDGET_TYPE] });
            expect(client.sendStateEvent).toHaveBeenCalledWith(ROOM_ID, LEGACY_WIDGET_TYPE, CONTENT, WIDGET_ID);
        });

        it("is only offered to someone allowed to send every type", () => {
            expect(canRecreateWidget(client, fake.room, entry)).toBe(false);
            fake.canSend.add(LEGACY_WIDGET_TYPE);
            expect(canRecreateWidget(client, fake.room, entry)).toBe(false);
            fake.canSend.add(WIDGET_TYPE);
            expect(canRecreateWidget(client, fake.room, entry)).toBe(true);
        });
    });

    describe("a widget the user removed themselves", () => {
        beforeEach(async () => {
            await addWidgetApp(client, fake.room, WIDGET_ID);
        });

        it("is found, and dropped", () => {
            setState(fake, stateEvent(LEGACY_WIDGET_TYPE, {}, ME, "$removed"));
            expect(findOwnRemovals(client)).toEqual([{ roomId: ROOM_ID, widgetId: WIDGET_ID }]);
        });

        it("isn't confused with someone else removing it", () => {
            setState(fake, stateEvent(LEGACY_WIDGET_TYPE, {}, "@mod:example.org", "$removed"));
            expect(findOwnRemovals(client)).toEqual([]);
        });

        it("isn't confused with the user changing it", () => {
            const ev = stateEvent(LEGACY_WIDGET_TYPE, { ...CONTENT, name: "Renamed" }, ME);
            setState(fake, ev);
            expect(isOwnRemoval(ev, ME)).toBe(false);
            expect(findOwnRemovals(client)).toEqual([]);
        });

        it("isn't checked in a room the user has left", () => {
            const left = makeRoom(KnownMembership.Leave);
            setState(left, stateEvent(LEGACY_WIDGET_TYPE, {}, ME, "$removed"));
            const otherClient = makeClient([left.room]);
            void otherClient.setAccountData(
                WIDGET_APPS_EVENT_TYPE as never,
                {
                    widgets: getWidgetAppEntries(client),
                } as never,
            );
            expect(findOwnRemovals(otherClient)).toEqual([]);
        });
    });

    describe("carrying over permission to load", () => {
        const entry: WidgetAppEntry = {
            room_id: ROOM_ID,
            widget_id: WIDGET_ID,
            state_types: [LEGACY_WIDGET_TYPE],
            content: CONTENT,
            sender: BRIDGE,
        };

        it("applies when the same account updates it on the same site", () => {
            const current = { ...entry, content: { ...CONTENT, url: "https://bridge.example.org/xdc/hub?game=chess" } };
            expect(widgetAppConsentCarriesOver(entry, current)).toBe(true);
        });

        it("doesn't when someone else set it", () => {
            expect(widgetAppConsentCarriesOver(entry, { ...entry, sender: "@other:example.org" })).toBe(false);
        });

        it("doesn't when it moved to another site", () => {
            const current = { ...entry, content: { ...CONTENT, url: "https://elsewhere.example.com/" } };
            expect(widgetAppConsentCarriesOver(entry, current)).toBe(false);
        });
    });

    it("names the room in menus unless its name is too long", () => {
        expect(goToRoomLabel("Fediverse Notifications")).toBe("Go to Fediverse Notifications");
        expect(goToRoomLabel("A room whose name goes on and on and on")).toBe("Go to room");
    });
});
