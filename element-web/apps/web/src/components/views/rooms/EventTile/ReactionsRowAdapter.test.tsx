/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { type MatrixEvent, type Relations } from "matrix-js-sdk/src/matrix";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "test-utils-rtl";
import { mkEvent, stubClient } from "test-utils";

import { ReactionsRowAdapter, getReactionGroups } from "./ReactionsRowAdapter";
import { type EventTileViewModel } from "../../../../viewmodels/room/timeline/event-tile/EventTileViewModel";
import MatrixClientContext from "../../../../contexts/MatrixClientContext";
import Modal from "../../../../Modal";

vi.mock("../../../../Modal");

const capturedButtonVms = vi.hoisted(() => ({ current: [] as Array<{ onContextMenu?: () => void }> }));

// Haven: avoid mounting the real ReactionsRowButtonView -> Tooltip (floating-ui) stack here - this
// test only cares whether `reactions` reaches the real ReactionsRowButtonViewModel construction,
// not the Tooltip rendering itself (covered separately by ReactionsRowButtonView.test.tsx).
vi.mock("@element-hq/web-shared-components", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@element-hq/web-shared-components")>();
    return {
        ...actual,
        ReactionsRowView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
        ReactionsRowButtonView: ({ vm }: { vm: { onContextMenu?: () => void } }) => {
            capturedButtonVms.current.push(vm);
            return null;
        },
    };
});

// Haven: regression coverage for the `reactions` Relations threading this adapter is responsible
// for - both getReactionGroups' own pure dedup logic, and that the full Relations object (not just
// this event's reaction groups) actually reaches the per-button viewmodel so its onContextMenu can
// open ReactionsDialog with every group, not only its own.
describe("ReactionsRowAdapter", () => {
    const roomId = "!room:example.org";
    let mxEvent: MatrixEvent;

    const mkReactionEvent = (userId: string, key: string): MatrixEvent =>
        mkEvent({
            event: true,
            type: "m.reaction",
            room: roomId,
            user: userId,
            content: { "m.relates_to": { rel_type: "m.annotation", event_id: "$parent", key } },
        });

    const mkReactions = (groups: Array<[string, MatrixEvent[]]>): Relations =>
        ({
            getSortedAnnotationsByKey: () => groups,
            getAnnotationsBySender: () => ({}),
            on: vi.fn(),
            off: vi.fn(),
        }) as unknown as Relations;

    const mkEventTileViewModel = (): EventTileViewModel => {
        const snapshot = { isVisible: true, showAllButtonVisible: false };
        // Haven: the real EventTileViewModel caches this child VM across calls (see
        // ReactionsRowAdapter.tsx's own comment on `releaseReactionsRowViewModel` - it's "owned by
        // EventTileViewModel, but scoped to this rendered adapter surface"). ReactionsRowAdapter
        // calls `getReactionsRowViewModel` unmemoized on every render, so a mock that fabricates a
        // NEW object (with a new `subscribe` reference) on every call breaks useViewModel's
        // useSyncExternalStore identity assumptions and sends React into a runaway resubscribe loop
        // - confirmed via a real OOM crash. Cache the returned object here to match real behavior.
        const rowVm = {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            setReactionGroupCount: vi.fn(),
            setActionable: vi.fn(),
            setCanReact: vi.fn(),
            setAddReactionHandlers: vi.fn(),
            setAddReactionButtonActive: vi.fn(),
        };
        return {
            getReactionsRowViewModel: vi.fn(() => rowVm),
            releaseReactionsRowViewModel: vi.fn(),
        } as unknown as EventTileViewModel;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("getReactionGroups dedupes annotations by key and drops empty groups", () => {
        const thumbsUp = mkReactionEvent("@alice:example.org", "👍");
        const reactions = mkReactions([
            ["👍", [thumbsUp]],
            ["👎", []],
        ]);
        expect(getReactionGroups(reactions)).toEqual([{ content: "👍", events: [thumbsUp] }]);
        expect(getReactionGroups(undefined)).toEqual([]);
    });

    it("threads the full Relations through to a reaction button's onContextMenu, not just its own group", () => {
        const modalSpy = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
        const client = stubClient();
        mxEvent = mkEvent({ event: true, type: "m.room.message", room: roomId, user: "@alice:example.org", content: {} });
        const reactions = mkReactions([
            ["👍", [mkReactionEvent("@alice:example.org", "👍")]],
            ["👎", [mkReactionEvent("@bob:example.org", "👎")]],
        ]);

        render(
            <MatrixClientContext.Provider value={client}>
                <ReactionsRowAdapter eventTileViewModel={mkEventTileViewModel()} mxEvent={mxEvent} reactions={reactions} />
            </MatrixClientContext.Provider>,
        );

        expect(capturedButtonVms.current.length).toBeGreaterThanOrEqual(1);
        capturedButtonVms.current[0].onContextMenu?.();

        expect(modalSpy).toHaveBeenCalledTimes(1);
        expect(modalSpy.mock.calls[0][1]).toMatchObject({ reactions });
    });
});
