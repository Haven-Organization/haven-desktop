// @vitest-environment happy-dom
// permalinkRouting.ts imports MatrixClientPeg, which constructs Modal's singleton ModalManager at
// module load - that needs a real, working dispatcher (register()) and DOM globals the project's
// default "node" environment doesn't provide.
import { describe, it, expect, vi, beforeEach } from "vitest";

// The component tree "../app"'s socialApp lazily pulls in once rendered isn't relevant here -
// tryRouteSocialHashScreen only needs socialApp.id.
vi.mock("../app", () => ({ socialApp: { id: "social" } }));

// Real popstate/history.state plumbing (see socialHistoryOrigin.ts's own doc) isn't worth
// exercising here either - only its return value, read by tryRouteSocialHashScreen, matters.
vi.mock("./socialHistoryOrigin", () => ({ getLastPopStateOrigin: vi.fn() }));

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { MatrixClientPeg } from "../../../../element-web/apps/web/src/MatrixClientPeg";
import { getLastPopStateOrigin } from "./socialHistoryOrigin";
import {
    navigateToPermalinkInApp,
    tryRouteSocialHashScreen,
    tryRouteSocialRoom,
    tryRouteSocialPermalink,
} from "./permalinkRouting";
import { MSC4501_ROOM_TYPE_PROFILE } from "./room-classifier";
import { SOCIAL_HOME_ACTION } from "../homeAction";
import { consumePendingViewPost } from "./pendingViewPost";
import { consumePendingFeedThread } from "./pendingFeedThread";
import { peekPendingSocialSection, clearPendingSocialSection } from "./pendingSocialSection";
import { consumePendingPostModal } from "./pendingPostModal";
import { peekPendingActiveAppId, clearPendingActiveAppId } from "../../framework/pendingActiveApp";

describe("tryRouteSocialHashScreen", () => {
    beforeEach(() => {
        // vi.spyOn on an already-spied method reuses the existing mock rather than re-wrapping it -
        // mockClear() is required here, not just mockImplementation(), or call history accumulates
        // across every test in this file instead of resetting per-test.
        vi.spyOn(defaultDispatcher, "dispatch").mockClear().mockImplementation(() => "");
        vi.mocked(getLastPopStateOrigin).mockReturnValue(undefined);
        // Drain any bridge state a previous test in this file left behind.
        consumePendingViewPost();
        consumePendingFeedThread();
        consumePendingPostModal();
        clearPendingSocialSection();
        clearPendingActiveAppId();
    });

    it("returns false, and dispatches nothing, for a non-social screen", () => {
        expect(tryRouteSocialHashScreen("room")).toBe(false);
        expect(defaultDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it("bare 'social': dispatches the home action, sets no pending post/section", () => {
        expect(tryRouteSocialHashScreen("social")).toBe(true);
        expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({ action: SOCIAL_HOME_ACTION }, true);
        expect(peekPendingActiveAppId()).toBe("social");
        expect(consumePendingPostModal()).toBeNull();
    });

    it("'social' with ?post=1: also queues the post-composer modal, empty by default", () => {
        tryRouteSocialHashScreen("social", { post: "1" });
        expect(consumePendingPostModal()).toEqual({ body: undefined });
    });

    it("'social' with ?post=1&body=...: queues the modal prefilled with that body", () => {
        tryRouteSocialHashScreen("social", { post: "1", body: "hello" });
        expect(consumePendingPostModal()).toEqual({ body: "hello" });
    });

    it("'social/groups': queues the groups section and dispatches the home action", () => {
        expect(tryRouteSocialHashScreen("social/groups")).toBe(true);
        expect(peekPendingSocialSection()).toBe("groups");
        expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({ action: SOCIAL_HOME_ACTION }, true);
    });

    it("'social/profile': queues the profile section", () => {
        tryRouteSocialHashScreen("social/profile");
        expect(peekPendingSocialSection()).toBe("profile");
    });

    it("'social/search': queues the search section", () => {
        tryRouteSocialHashScreen("social/search");
        expect(peekPendingSocialSection()).toBe("search");
    });

    it("a bare room id with no event, no popstate origin: routes to the dedicated room page", () => {
        expect(tryRouteSocialHashScreen("social/room/!room:example.org")).toBe(true);
        expect(consumePendingViewPost()).toEqual({ roomId: "!room:example.org", eventId: undefined });
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("room + event, no popstate origin (a typed/shared link): routes to the dedicated room page", () => {
        tryRouteSocialHashScreen("social/room/!room:example.org/$event");
        expect(consumePendingViewPost()).toEqual({ roomId: "!room:example.org", eventId: "$event" });
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("room + event, popstate origin 'room': still routes to the dedicated room page", () => {
        vi.mocked(getLastPopStateOrigin).mockReturnValue("room");
        tryRouteSocialHashScreen("social/room/!room:example.org/$event");
        expect(consumePendingViewPost()).not.toBeNull();
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("room + event, popstate origin 'feed': reopens the Feed's own thread panel instead", () => {
        vi.mocked(getLastPopStateOrigin).mockReturnValue("feed");
        expect(tryRouteSocialHashScreen("social/room/!room:example.org/$event")).toBe(true);
        expect(consumePendingFeedThread()).toEqual({ roomId: "!room:example.org", eventId: "$event" });
        expect(consumePendingViewPost()).toBeNull();
    });

    it("room, no event at all, popstate origin 'feed': still goes to the dedicated room page (no event to reopen a thread on)", () => {
        vi.mocked(getLastPopStateOrigin).mockReturnValue("feed");
        tryRouteSocialHashScreen("social/room/!room:example.org");
        expect(consumePendingViewPost()).toEqual({ roomId: "!room:example.org", eventId: undefined });
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("an empty room id is rejected outright", () => {
        expect(tryRouteSocialHashScreen("social/room/")).toBe(false);
        expect(defaultDispatcher.dispatch).not.toHaveBeenCalled();
    });
});

// Haven: regression coverage for threading a permalink's own ?via= server hints into the room
// summary lookup. Without them, MSC3266's summary endpoint can't resolve a room this homeserver
// hasn't already federated with, so a perfectly reachable public/knockable room was wrongly treated
// as unclassifiable (and the click fell through to the "Private profile" path). Upstream merges
// don't touch this file, but it's the same class of "quietly stops passing an optional argument"
// regression the other tests here guard against.
describe("via server hints for room-summary lookups", () => {
    const getRoomSummary = vi.fn();

    beforeEach(() => {
        getRoomSummary.mockReset().mockResolvedValue({ room_id: "!room:example.org", room_type: undefined });
        vi.spyOn(MatrixClientPeg, "get").mockReturnValue({
            getRoom: () => null,
            getRoomSummary,
        } as any);
    });

    it("tryRouteSocialRoom passes the via list through to getRoomSummary for a room not known locally", () => {
        const onNotSocial = vi.fn();
        expect(tryRouteSocialRoom({}, "!room:example.org", null, onNotSocial, ["a.example", "b.example"])).toBe(true);
        expect(getRoomSummary).toHaveBeenCalledWith("!room:example.org", ["a.example", "b.example"]);
    });

    it("tryRouteSocialRoom without any via still calls getRoomSummary, with undefined (not null)", () => {
        tryRouteSocialRoom({}, "!room:example.org", null, vi.fn());
        tryRouteSocialRoom({}, "!room:example.org", null, vi.fn(), null);
        expect(getRoomSummary).toHaveBeenNthCalledWith(1, "!room:example.org", undefined);
        expect(getRoomSummary).toHaveBeenNthCalledWith(2, "!room:example.org", undefined);
    });

    it("tryRouteSocialPermalink forwards the permalink's own ?via= servers", () => {
        expect(
            tryRouteSocialPermalink({}, "https://matrix.to/#/!room:example.org/$event?via=a.example&via=b.example"),
        ).toBe(true);
        expect(getRoomSummary).toHaveBeenCalledWith("!room:example.org", ["a.example", "b.example"]);
    });
});

// Widget navigate requests (and matrix.to links a widget opens in the desktop app) don't come from
// a click handler, so they need this to reach Social the way a clicked link does.
describe("navigateToPermalinkInApp", () => {
    const getRoomSummary = vi.fn();

    beforeEach(() => {
        vi.spyOn(defaultDispatcher, "dispatch").mockClear().mockImplementation(() => "");
        consumePendingViewPost();
        clearPendingActiveAppId();
        window.location.hash = "";
        getRoomSummary.mockReset();
        vi.spyOn(MatrixClientPeg, "get").mockReturnValue({ getRoom: () => null, getRoomSummary } as any);
    });

    it("opens a post in a Social profile room in Social", async () => {
        getRoomSummary.mockResolvedValue({ room_id: "!profile:example.org", room_type: MSC4501_ROOM_TYPE_PROFILE });
        navigateToPermalinkInApp("https://matrix.to/#/!profile:example.org/$post?via=example.org");

        await vi.waitFor(() =>
            expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({ action: SOCIAL_HOME_ACTION }, true),
        );
        expect(consumePendingViewPost()).toMatchObject({ roomId: "!profile:example.org", eventId: "$post" });
        expect(window.location.hash).toBe("");
    });

    it("opens any other room in the regular room view", async () => {
        getRoomSummary.mockResolvedValue({ room_id: "!chat:example.org", room_type: undefined });
        navigateToPermalinkInApp("https://matrix.to/#/!chat:example.org/$event");

        await vi.waitFor(() => expect(window.location.hash).toBe("#/room/!chat:example.org/$event"));
        expect(defaultDispatcher.dispatch).not.toHaveBeenCalledWith({ action: SOCIAL_HOME_ACTION }, true);
    });

    it("opens a user link the stock way", () => {
        navigateToPermalinkInApp("https://matrix.to/#/@alice:example.org");
        expect(window.location.hash).toBe("#/user/@alice:example.org");
        expect(getRoomSummary).not.toHaveBeenCalled();
    });

    it("throws for a link that isn't a permalink", () => {
        expect(() => navigateToPermalinkInApp("https://example.org/")).toThrow();
    });
});
