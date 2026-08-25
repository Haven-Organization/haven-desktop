/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { stubClient } from "test-utils";

import RightPanelStore from "./RightPanelStore";
import { RightPanelPhases } from "./RightPanelStorePhases";
import { UPDATE_EVENT } from "../AsyncStore";

describe("RightPanelStore", () => {
    let store: RightPanelStore;

    beforeEach(() => {
        stubClient();
        store = RightPanelStore.instance;
        store.reset();
    });

    // Haven: regression coverage for updateViewedRoomIdForNavigationCursor - called synchronously by
    // RoomListViewModel.handleViewRoomDelta the instant Alt+Up/Down moves the keyboard cursor, well
    // before the debounced real room load lands and fires Action.ActiveRoomChanged. Without this,
    // viewedRoomId stayed pointed at the previous room for that whole debounce window, so toggling
    // the right panel right after Alt+Up/Down silently acted on the wrong, no-longer-visible room.
    describe("updateViewedRoomIdForNavigationCursor", () => {
        it("retargets isOpenForRoom/currentCardForRoom-style getters at the new room immediately", () => {
            store.setCard({ phase: RightPanelPhases.RoomSummary }, true, "!roomA:example.org");
            expect(store.isOpenForRoom("!roomA:example.org")).toBe(true);

            store.updateViewedRoomIdForNavigationCursor("!roomB:example.org");

            // isOpen (no roomId arg) reads via the now-updated viewedRoomId - roomB has no panel
            // state yet, so it must read as closed, NOT fall through to roomA's open state.
            expect(store.isOpen).toBe(false);
            expect(store.currentCard.phase).toBeNull();
        });

        it("does not emit an update event on its own", () => {
            let emitted = false;
            store.on(UPDATE_EVENT, () => {
                emitted = true;
            });

            store.updateViewedRoomIdForNavigationCursor("!roomC:example.org");

            expect(emitted).toBe(false);
        });
    });

    // Haven: regression coverage for togglePanel's "never shown before" fix - a room with no
    // byRoom[rId] entry yet (no persisted RightPanel.phases state, e.g. the first time the "toggle
    // right panel" shortcut is pressed in a given room) used to silently no-op instead of opening
    // the panel fresh with the same Room Info default the mouse-driven header button falls back to.
    describe("togglePanel", () => {
        it("opens the panel with the Room Info phase for a room that has never had one before", () => {
            store.updateViewedRoomIdForNavigationCursor("!freshRoom:example.org");
            expect(store.isOpenForRoom("!freshRoom:example.org")).toBe(false);

            store.togglePanel("!freshRoom:example.org");

            expect(store.isOpenForRoom("!freshRoom:example.org")).toBe(true);
            expect(store.currentCardForRoom("!freshRoom:example.org").phase).toBe(RightPanelPhases.RoomSummary);
        });

        it("still toggles closed->open->closed normally once a room has panel state", () => {
            store.setCard({ phase: RightPanelPhases.RoomSummary }, true, "!roomD:example.org");
            expect(store.isOpenForRoom("!roomD:example.org")).toBe(true);

            store.togglePanel("!roomD:example.org");
            expect(store.isOpenForRoom("!roomD:example.org")).toBe(false);

            store.togglePanel("!roomD:example.org");
            expect(store.isOpenForRoom("!roomD:example.org")).toBe(true);
        });
    });
});
