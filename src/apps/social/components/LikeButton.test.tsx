/*
 * Social Overlay - LikeButton canOpenPicker/onPickerBlocked tests
 *
 * Regression coverage for the "react via the hover emoji picker on a peeked post" fix: stock
 * ReactionPicker.onChoose sends its reaction synchronously with no return value or thrown error
 * this button could intercept, so a reaction that's known in advance to be impossible (peeking a
 * room without being a member) has to be caught *before* the real picker ever opens, not after -
 * see this component's own canOpenPicker doc, and SocialEventTile.tsx's showActionRequiresFollowModal.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "test-utils-rtl";
import { mkEvent } from "test-utils";

import { LikeButton } from "./LikeButton";

vi.mock("../../../../element-web/apps/web/src/components/views/emojipicker/ReactionPicker", () => ({
    default: () => <div data-testid="real-reaction-picker" />,
}));

const event = mkEvent({
    event: true,
    type: "m.room.message",
    room: "!peeked:example.org",
    user: "@other:example.org",
    content: { body: "the post" },
});

describe("LikeButton", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("opens the real picker on hover by default (canOpenPicker omitted)", () => {
        render(<LikeButton event={event} isLiked={false} count={0} onLike={vi.fn()} />);
        fireEvent.mouseEnter(screen.getByRole("button"));
        act(() => {
            vi.advanceTimersByTime(400);
        });
        expect(screen.getByTestId("real-reaction-picker")).toBeInTheDocument();
    });

    it("calls onPickerBlocked instead of opening the picker when canOpenPicker is false", () => {
        const onPickerBlocked = vi.fn();
        render(
            <LikeButton
                event={event}
                isLiked={false}
                count={0}
                onLike={vi.fn()}
                canOpenPicker={false}
                onPickerBlocked={onPickerBlocked}
            />,
        );
        fireEvent.mouseEnter(screen.getByRole("button"));
        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(onPickerBlocked).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("real-reaction-picker")).not.toBeInTheDocument();
    });

    it("does not call onPickerBlocked if the mouse leaves before the hover delay elapses", () => {
        const onPickerBlocked = vi.fn();
        render(
            <LikeButton
                event={event}
                isLiked={false}
                count={0}
                onLike={vi.fn()}
                canOpenPicker={false}
                onPickerBlocked={onPickerBlocked}
            />,
        );
        const button = screen.getByRole("button");
        fireEvent.mouseEnter(button);
        act(() => {
            vi.advanceTimersByTime(100);
        });
        fireEvent.mouseLeave(button);
        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(onPickerBlocked).not.toHaveBeenCalled();
    });
});
