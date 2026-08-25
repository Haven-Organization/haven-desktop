/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { type MatrixEvent, type Relations } from "matrix-js-sdk/src/matrix";
import { describe, it, expect, vi } from "vitest";
import { act, render } from "test-utils-rtl";
import { mkEvent } from "test-utils";

import { ActionBarAdapter } from "./ActionBarAdapter";
import { type EventTileViewModel } from "../../../../viewmodels/room/timeline/event-tile/EventTileViewModel";

const capturedOnOptionsClick = vi.hoisted(() => ({ current: undefined as ((anchor: HTMLElement | null) => void) | undefined }));
const capturedOnReactionsClick = vi.hoisted(() => ({ current: undefined as ((anchor: HTMLElement | null) => void) | undefined }));
const messageContextMenuProps = vi.hoisted(() => ({ current: undefined as any }));
const reactionPickerProps = vi.hoisted(() => ({ current: undefined as any }));

vi.mock("@element-hq/web-shared-components", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@element-hq/web-shared-components")>();
    return { ...actual, ActionBarView: () => null };
});
vi.mock("../../context_menus/MessageContextMenu", () => ({
    default: (props: any) => {
        messageContextMenuProps.current = props;
        return <div data-testid="message-context-menu" />;
    },
}));
vi.mock("../../emojipicker/ReactionPicker", () => ({
    default: (props: any) => {
        reactionPickerProps.current = props;
        return <div data-testid="reaction-picker" />;
    },
}));

// Haven: regression coverage for the `reactions` Relations prop this adapter threads through to
// both the "..." message menu (its own Reactions dialog entry point) and the inline reaction
// picker - a real bug this session found MessageContextMenu missing the prop entirely at one point.
describe("ActionBarAdapter", () => {
    const mkEventTileViewModel = (): EventTileViewModel =>
        ({
            getActionBarViewModel: vi.fn((props) => {
                capturedOnOptionsClick.current = props.onOptionsClick;
                capturedOnReactionsClick.current = props.onReactionsClick;
                return { getSnapshot: () => ({}), subscribe: vi.fn(() => vi.fn()), setProps: vi.fn() };
            }),
            releaseActionBarViewModel: vi.fn(),
        }) as unknown as EventTileViewModel;

    const baseProps = (reactions?: Relations | null) => ({
        eventTileViewModel: mkEventTileViewModel(),
        mxEvent: mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} }) as MatrixEvent,
        reactions,
        getTile: () => null,
        getReplyChain: () => null,
        toggleThreadExpanded: vi.fn(),
    });

    it("threads reactions through to MessageContextMenu once the options menu is opened", () => {
        const reactions = {} as Relations;
        render(<ActionBarAdapter {...baseProps(reactions)} />);

        act(() => capturedOnOptionsClick.current?.(document.createElement("button")));

        expect(messageContextMenuProps.current).toMatchObject({ reactions });
    });

    it("threads reactions through to ReactionPicker once the reactions menu is opened", () => {
        const reactions = {} as Relations;
        render(<ActionBarAdapter {...baseProps(reactions)} />);

        act(() => capturedOnReactionsClick.current?.(document.createElement("button")));

        expect(reactionPickerProps.current).toMatchObject({ reactions });
    });

    it("passes reactions through as undefined when none are available", () => {
        render(<ActionBarAdapter {...baseProps(undefined)} />);

        act(() => capturedOnOptionsClick.current?.(document.createElement("button")));

        expect(messageContextMenuProps.current).toMatchObject({ reactions: undefined });
    });
});
