/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { type MatrixEvent, type Relations } from "matrix-js-sdk/src/matrix";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "test-utils-rtl";
import { stubClient, mkEvent, mkStubRoom } from "test-utils";

import MessageContextMenu from "./MessageContextMenu";
import dis from "../../../dispatcher/dispatcher";
import Modal from "../../../Modal";
import { Action } from "../../../dispatcher/actions";
import { getPackableImageFromEvent } from "../../../utils/ImagePacks";
import { getImageSourcePackRefs } from "../../../utils/imageSourcePacks";
import { getReactionGroups } from "../rooms/EventTile/ReactionsRowAdapter";
import { getForwardableEvent } from "../../../events/forward/getForwardableEvent";

vi.mock("../../../dispatcher/dispatcher");
vi.mock("../../../Modal");
vi.mock("../../../utils/ImagePacks", async () => ({
    ...(await vi.importActual("../../../utils/ImagePacks")),
    getPackableImageFromEvent: vi.fn(),
}));
vi.mock("../../../utils/imageSourcePacks", () => ({
    getImageSourcePackRefs: vi.fn().mockReturnValue([]),
}));
vi.mock("../rooms/EventTile/ReactionsRowAdapter", () => ({
    getReactionGroups: vi.fn().mockReturnValue([]),
}));
vi.mock("../../../events/forward/getForwardableEvent", () => ({
    getForwardableEvent: vi.fn(),
}));

describe("MessageContextMenu", () => {
    let mxEvent: MatrixEvent;

    beforeEach(() => {
        vi.clearAllMocks();
        const client = stubClient();
        const room = mkStubRoom("!room:example.org", "room", client);
        mxEvent = mkEvent({
            event: true,
            type: "m.room.message",
            room: room.roomId,
            user: "@alice:example.org",
            content: { msgtype: "m.text", body: "hello" },
        });
        vi.mocked(getForwardableEvent).mockReturnValue(mxEvent);
    });

    function renderMenu(props: Partial<React.ComponentProps<typeof MessageContextMenu>> = {}) {
        return render(
            <MessageContextMenu
                mxEvent={mxEvent}
                onFinished={vi.fn()}
                {...props}
            />,
        );
    }

    // Haven: regression coverage for Shift+clicking Forward pre-unchecking the Body toggle in
    // ForwardDialog (initialOmitBody) - a plain click must NOT set it.
    describe("Forward - Shift+click pre-unchecks the Body toggle", () => {
        it("dispatches initialOmitBody: false on a plain click", () => {
            renderMenu();
            fireEvent.click(screen.getByText("Forward"));

            expect(dis.dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.OpenForwardDialog, initialOmitBody: false }),
            );
        });

        it("dispatches initialOmitBody: true on a Shift+click", () => {
            renderMenu();
            fireEvent.click(screen.getByText("Forward"), { shiftKey: true });

            expect(dis.dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.OpenForwardDialog, initialOmitBody: true }),
            );
        });
    });

    // Haven: regression coverage for MSC2545 image-pack detection gating the "Add to Pack" option -
    // only an unencrypted m.sticker/m.image event actually has anything addable.
    describe("Add to pack - MSC2545 gating", () => {
        it("does not show 'Add to pack' when the event has no packable image", () => {
            vi.mocked(getPackableImageFromEvent).mockReturnValue(undefined);
            renderMenu();
            expect(screen.queryByText("Add to Pack")).not.toBeInTheDocument();
        });

        it("shows 'Add to pack' and opens AddToPackDialog when the event has a packable image", () => {
            vi.mocked(getPackableImageFromEvent).mockReturnValue({ url: "mxc://example.org/abc", body: "img" } as any);
            renderMenu();

            const button = screen.getByText("Add to Pack");
            fireEvent.click(button);

            expect(Modal.createDialog).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ mxEvent }),
                "mx_AddToPackDialog_wrapper",
            );
        });
    });

    // Haven: regression coverage for the Reactions menu entry (the "..." menu equivalent of
    // right-clicking a reaction pill) - only shown when there's at least one reaction group.
    describe("Reactions menu entry", () => {
        it("is hidden when there are no reactions", () => {
            renderMenu({ reactions: undefined });
            expect(screen.queryByText("Reactions")).not.toBeInTheDocument();
        });

        it("opens ReactionsDialog when clicked with a reaction group present", () => {
            vi.mocked(getReactionGroups).mockReturnValue([{ content: "👍", events: [mxEvent] }] as any);
            const reactions = {} as Relations;
            renderMenu({ reactions });

            fireEvent.click(screen.getByText("Reactions"));

            expect(Modal.createDialog).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ mxEvent, reactions }),
                "mx_ReactionsDialog_wrapper",
            );
        });
    });

    // Haven: regression coverage for MSC4459 "find the pack" gating - only shown when the event
    // carries image-pack provenance metadata.
    describe("Find Pack menu entry", () => {
        it("is hidden when the event has no image-source-pack refs", () => {
            vi.mocked(getImageSourcePackRefs).mockReturnValue([]);
            renderMenu();
            expect(screen.queryByText("Find Pack")).not.toBeInTheDocument();
        });

        it("opens FindPackDialog with the first ref when clicked", () => {
            const packRef = { roomId: "!pack:example.org", eventId: "$pack" } as any;
            vi.mocked(getImageSourcePackRefs).mockReturnValue([packRef]);
            renderMenu();

            fireEvent.click(screen.getByText("Find Pack"));

            expect(Modal.createDialog).toHaveBeenCalledWith(
                expect.anything(),
                { packRef },
                "mx_FindPackDialog_wrapper",
            );
        });
    });
});
