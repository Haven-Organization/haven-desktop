/*
 * Social Overlay - socialScreen tests
 *
 * Opening a post from the stock room view must leave exactly one new history entry (the post), so
 * Back returns to the room view - see pendingSocialScreen.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { writeSocialScreen } from "./socialScreen";
import { clearPendingSocialScreen, peekPendingSocialScreen, setPendingSocialScreen } from "./pendingSocialScreen";
import { onNewScreen } from "../../../../element-web/apps/web/src/vector/routing";

vi.mock("../../../../element-web/apps/web/src/vector/routing", () => ({ onNewScreen: vi.fn() }));

const ROOM = "!room:example.org";
const EVENT = "$event";

describe("writeSocialScreen", () => {
    beforeEach(() => {
        vi.mocked(onNewScreen).mockClear();
        clearPendingSocialScreen();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("writes every screen when nothing is pending", () => {
        writeSocialScreen("social");
        writeSocialScreen(`social/room/${ROOM}`);
        expect(vi.mocked(onNewScreen).mock.calls.map((c) => c[0])).toEqual(["social", `social/room/${ROOM}`]);
    });

    it("skips intermediate pages on the way to a post, then writes only the post", () => {
        setPendingSocialScreen(ROOM, EVENT);

        writeSocialScreen("social"); // Social mounting on the Feed it was last on
        writeSocialScreen(`social/room/${ROOM}`); // the room's page, before the post opens
        writeSocialScreen(`social/room/${ROOM}/${EVENT}`); // the post itself

        expect(vi.mocked(onNewScreen).mock.calls.map((c) => c[0])).toEqual([`social/room/${ROOM}/${EVENT}`]);
    });

    it("goes back to writing normally once the destination has been written", () => {
        setPendingSocialScreen(ROOM, EVENT);
        writeSocialScreen(`social/room/${ROOM}/${EVENT}`);
        writeSocialScreen("social");

        expect(peekPendingSocialScreen()).toBeNull();
        expect(vi.mocked(onNewScreen)).toHaveBeenLastCalledWith("social");
    });

    it("treats a bare room destination the same way", () => {
        setPendingSocialScreen(ROOM, null);
        writeSocialScreen("social");
        writeSocialScreen(`social/room/${ROOM}`);

        expect(vi.mocked(onNewScreen).mock.calls.map((c) => c[0])).toEqual([`social/room/${ROOM}`]);
    });

    it("stops suppressing if the destination is never reached", () => {
        vi.useFakeTimers();
        setPendingSocialScreen(ROOM, EVENT);
        writeSocialScreen("social");
        expect(onNewScreen).not.toHaveBeenCalled();

        vi.advanceTimersByTime(11_000);
        writeSocialScreen("social");
        expect(onNewScreen).toHaveBeenCalledWith("social");
    });
});
