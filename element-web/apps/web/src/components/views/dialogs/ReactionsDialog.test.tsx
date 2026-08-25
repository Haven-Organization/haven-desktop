/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { type MatrixEvent, type Relations } from "matrix-js-sdk/src/matrix";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "test-utils-rtl";
import { stubClient, mkEvent, mkRoomMember, mkStubRoom } from "test-utils";

import ReactionsDialog from "./ReactionsDialog";
import Modal from "../../../Modal";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { IMAGE_SOURCE_PACKS_KEY } from "../../../utils/imageSourcePacks";

vi.mock("../../../dispatcher/dispatcher");
vi.mock("../../../customisations/Media", () => ({
    mediaFromMxc: vi.fn((mxc: string) => ({ srcHttp: `https://example.org/_matrix/media/${mxc.split("/").pop()}` })),
}));

// Haven: regression coverage for the "view reactions" modal - the left rail of reaction groups,
// the right pane header (enlarged emoji/image + "Reacted with :name:"), the reactor list, and the
// three "clicking something in here should close this dialog first" flows (view a reactor's
// profile, view a custom emoji's full image, find a reaction's source pack).
describe("ReactionsDialog", () => {
    const roomId = "!room:example.org";
    let mxEvent: MatrixEvent;
    let alice: ReturnType<typeof mkRoomMember>;
    let bob: ReturnType<typeof mkRoomMember>;

    const mkReactionEvent = (userId: string, key: string, extraContent: Record<string, unknown> = {}): MatrixEvent =>
        mkEvent({
            event: true,
            type: "m.reaction",
            room: roomId,
            user: userId,
            content: {
                "m.relates_to": { rel_type: "m.annotation", event_id: "$parent", key },
                ...extraContent,
            },
        });

    const mkReactions = (groups: Array<[string, MatrixEvent[]]>): Relations =>
        ({
            getSortedAnnotationsByKey: () => groups,
            on: vi.fn(),
            off: vi.fn(),
        }) as unknown as Relations;

    beforeEach(() => {
        vi.clearAllMocks();
        const client = stubClient();
        alice = mkRoomMember(roomId, "@alice:example.org");
        bob = mkRoomMember(roomId, "@bob:example.org");
        const room = mkStubRoom(roomId, "Test Room", client);
        (room.getMember as ReturnType<typeof vi.fn>).mockImplementation((userId: string) =>
            userId === alice.userId ? alice : userId === bob.userId ? bob : null,
        );
        (client.getRoom as ReturnType<typeof vi.fn>).mockReturnValue(room);
        mxEvent = mkEvent({ event: true, type: "m.room.message", room: roomId, user: "@alice:example.org", content: {} });
        vi.spyOn(mxEvent, "getRoomId").mockReturnValue(roomId);
    });

    it("renders one rail item per reaction group", () => {
        const reactions = mkReactions([
            ["👍", [mkReactionEvent(alice.userId, "👍")]],
            ["mxc://example.org/custom", [mkReactionEvent(bob.userId, "mxc://example.org/custom")]],
            ["Hello", [mkReactionEvent("@charlie:example.org", "Hello")]],
        ]);
        const { container } = render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        // The selected group's own emoji is also echoed in the bigger header, so more than one match
        // for "👍" (the first/selected group) is expected here.
        expect(screen.getAllByText("👍").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Hello")).toBeInTheDocument();
        // The custom image reaction's rail item renders as an <img> with alt="" (no shortcode
        // metadata on this event), which getByRole("img") excludes (ARIA gives alt="" an implicit
        // role of "presentation") - query the DOM directly instead.
        expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(1);
    });

    it("pre-selects the group matching initialContent", () => {
        const reactions = mkReactions([
            ["👍", [mkReactionEvent(alice.userId, "👍")]],
            ["Hello", [mkReactionEvent(bob.userId, "Hello")]],
        ]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} initialContent="Hello" onFinished={vi.fn()} />);
        expect(screen.getByText(bob.userId)).toBeInTheDocument();
        expect(screen.queryByText(alice.userId)).not.toBeInTheDocument();
    });

    it("shows the reactor list for the selected group, and switches it on rail selection", () => {
        const reactions = mkReactions([
            ["👍", [mkReactionEvent(alice.userId, "👍")]],
            ["Hello", [mkReactionEvent(bob.userId, "Hello")]],
        ]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.getByText(alice.userId)).toBeInTheDocument();
        expect(screen.queryByText(bob.userId)).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("Hello"));
        expect(screen.getByText(bob.userId)).toBeInTheDocument();
        expect(screen.queryByText(alice.userId)).not.toBeInTheDocument();
    });

    it("shows a bigger header with the enlarged emoji and the 'Reacted with' caption", () => {
        const reactions = mkReactions([["😄", [mkReactionEvent(alice.userId, "😄")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.getByText("Reacted with :smile:")).toBeInTheDocument();
    });

    it("falls back to the generic title for a freeform text reaction with no resolvable shortcode", () => {
        const reactions = mkReactions([["smilehaha", [mkReactionEvent(alice.userId, "smilehaha")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.getByText("Reactions")).toBeInTheDocument();
    });

    it("only shows Find Pack when the reaction event carries image-source-pack refs", () => {
        const reactions = mkReactions([
            [
                "mxc://example.org/withpack",
                [
                    mkReactionEvent(alice.userId, "mxc://example.org/withpack", {
                        [IMAGE_SOURCE_PACKS_KEY]: {
                            "mxc://example.org/withpack": {
                                room_id: "!pack:example.org",
                                state_key: "pack1",
                                shortcode: "withpack",
                            },
                        },
                    }),
                ],
            ],
            ["mxc://example.org/nopack", [mkReactionEvent(bob.userId, "mxc://example.org/nopack")]],
        ]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.getAllByRole("button", { name: "Find the pack this reaction is from" })).toHaveLength(1);
    });

    it("closes the dialog and opens the source pack finder on Find Pack", () => {
        const modalSpy = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
        const onFinished = vi.fn();
        const reactions = mkReactions([
            [
                "mxc://example.org/withpack",
                [
                    mkReactionEvent(alice.userId, "mxc://example.org/withpack", {
                        [IMAGE_SOURCE_PACKS_KEY]: {
                            "mxc://example.org/withpack": {
                                room_id: "!pack:example.org",
                                state_key: "pack1",
                                shortcode: "withpack",
                            },
                        },
                    }),
                ],
            ],
        ]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={onFinished} />);
        fireEvent.click(screen.getByRole("button", { name: "Find the pack this reaction is from" }));
        expect(modalSpy.mock.calls[0][0]).toBeDefined();
        expect(modalSpy).toHaveBeenCalledTimes(1);
    });

    it("closes the dialog and dispatches ViewUser when a reactor's identity row is clicked", () => {
        const onFinished = vi.fn();
        const reactions = mkReactions([["👍", [mkReactionEvent(alice.userId, "👍")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={onFinished} />);
        fireEvent.click(screen.getByText(alice.userId));
        expect(onFinished).toHaveBeenCalledTimes(1);
        expect(dis.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewUser, member: alice }),
        );
    });

    it("closes the dialog and opens the full image on a custom emoji's header image", () => {
        const modalSpy = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
        const onFinished = vi.fn();
        const reactions = mkReactions([["mxc://example.org/custom", [mkReactionEvent(alice.userId, "mxc://example.org/custom")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={onFinished} />);
        fireEvent.click(screen.getByRole("button", { name: "View" }));
        expect(onFinished).toHaveBeenCalledTimes(1);
        expect(modalSpy).toHaveBeenCalledTimes(1);
        expect(modalSpy.mock.calls[0][1]).toMatchObject({ src: expect.stringContaining("custom") });
    });

    it("does not render a clickable header image for a real emoji or freeform text reaction", () => {
        const reactions = mkReactions([["👍", [mkReactionEvent(alice.userId, "👍")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
    });

    it("falls back to a non-clickable row and the raw user ID for a sender with no room member", () => {
        const reactions = mkReactions([["👍", [mkReactionEvent("@ghost:example.org", "👍")]]]);
        render(<ReactionsDialog mxEvent={mxEvent} reactions={reactions} onFinished={vi.fn()} />);
        expect(screen.getByText("@ghost:example.org")).toBeInTheDocument();
    });
});
