/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { EventType, type MatrixClient, type MatrixEvent, type Relations, RelationType, type Room } from "matrix-js-sdk/src/matrix";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createTestClient, mkEvent, mkStubRoom } from "test-utils";

import { ReactionsRowButtonViewModel, type ReactionsRowButtonViewModelProps } from "./ReactionsRowButtonViewModel";
import { type ReactionsRowButtonTooltipViewModel } from "./ReactionsRowButtonTooltipViewModel";
import dis from "../../../../../dispatcher/dispatcher";
import Modal from "../../../../../Modal";
import ReactionsDialog from "../../../../../components/views/dialogs/ReactionsDialog";

vi.mock("../../../../../dispatcher/dispatcher");
vi.mock("../../../../../Modal");
vi.mock("../../../../../customisations/Media", () => ({
    mediaFromMxc: vi.fn(() => ({ srcHttp: "https://example.org/_matrix/media/reaction.png" })),
}));

describe("ReactionsRowButtonViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let mxEvent: MatrixEvent;

    const createReactionEvent = (senderId: string, key = "👍"): MatrixEvent => {
        return mkEvent({
            event: true,
            type: "m.reaction",
            room: room.roomId,
            user: senderId,
            content: {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: mxEvent.getId(),
                    key,
                },
            },
        });
    };

    const createProps = (overrides?: Partial<ReactionsRowButtonViewModelProps>): ReactionsRowButtonViewModelProps => ({
        client,
        mxEvent,
        content: "👍",
        count: 2,
        reactionEvents: [createReactionEvent("@alice:example.org"), createReactionEvent("@bob:example.org")],
        disabled: false,
        customReactionImagesEnabled: false,
        ...overrides,
    });

    const getTooltipVm = (vm: ReactionsRowButtonViewModel): ReactionsRowButtonTooltipViewModel =>
        vm.getSnapshot().tooltipVm as ReactionsRowButtonTooltipViewModel;
    const getAriaLabel = (vm: ReactionsRowButtonViewModel): string | undefined =>
        (vm.getSnapshot() as { ariaLabel?: string }).ariaLabel;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
        room = mkStubRoom("!room:example.org", "Test Room", client);
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        mxEvent = mkEvent({
            event: true,
            type: "m.room.message",
            room: room.roomId,
            user: "@sender:example.org",
            content: { body: "Test message", msgtype: "m.text" },
        });
    });

    it("updates count with merge and does not touch tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const listener = vi.fn();
        vm.subscribe(listener);

        vm.setCount(5);

        expect(vm.getSnapshot().count).toBe(5);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();

        vm.setCount(6);

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("includes an ariaLabel in the snapshot", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());

        expect(getAriaLabel(vm)).toContain("reacted with 👍");
    });

    it("falls back when no room is available", () => {
        vi.spyOn(client, "getRoom").mockReturnValue(null);

        const vm = new ReactionsRowButtonViewModel(createProps());

        expect(getAriaLabel(vm)).toBeUndefined();
        expect(vm.getSnapshot().content).toBe("👍");
        expect(vm.getSnapshot().count).toBe(2);
    });

    it("renders custom reaction images with shortcode labels when enabled", () => {
        const reactionEvent = createReactionEvent("@alice:example.org", "mxc://example.org/reaction");
        reactionEvent.getContent()["shortcode"] = "party";

        const vm = new ReactionsRowButtonViewModel(
            createProps({
                content: "mxc://example.org/reaction",
                reactionEvents: [reactionEvent],
                customReactionImagesEnabled: true,
            }),
        );

        expect(vm.getSnapshot()).toMatchObject({
            imageSrc: "https://example.org/_matrix/media/reaction.png",
            imageAlt: "party",
        });
        expect(getAriaLabel(vm)).toContain("reacted with party");
    });

    it("updates selected state with myReactionEvent without touching tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const listener = vi.fn();
        vm.subscribe(listener);
        const myReactionEvent = createReactionEvent("@me:example.org");

        vm.setMyReactionEvent(myReactionEvent);

        expect(vm.getSnapshot().isSelected).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();
    });

    it("updates disabled state without touching tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps({ disabled: false }));
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");

        vm.setDisabled(true);

        expect(vm.getSnapshot().isDisabled).toBe(true);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();
    });

    it("setReactionData forwards to tooltip via setProps and updates snapshot content", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const reactionEvents = [createReactionEvent("@carol:example.org", "👎")];

        vm.setReactionData("👎", reactionEvents, false);

        expect(vm.getSnapshot().content).toBe("👎");
        expect(tooltipSetPropsSpy).toHaveBeenCalledWith({
            content: "👎",
            reactionEvents,
            customReactionImagesEnabled: false,
        });

        vm.setReactionData("👎", reactionEvents, false);

        expect(tooltipSetPropsSpy).toHaveBeenCalledTimes(2);
    });

    it("redacts reaction on click when myReactionEvent exists", () => {
        const myReactionEvent = createReactionEvent("@me:example.org");
        const vm = new ReactionsRowButtonViewModel(createProps({ myReactionEvent }));

        vm.onClick();

        expect(client.redactEvent).toHaveBeenCalledWith(room.roomId, myReactionEvent.getId());
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("sends reaction and dispatches message_sent when no myReactionEvent exists", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());

        vm.onClick();

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": {
                rel_type: RelationType.Annotation,
                event_id: mxEvent.getId(),
                key: "👍",
            },
        });
        expect(dis.dispatch).toHaveBeenCalledWith({ action: "message_sent" });
    });

    it("does nothing on click when disabled", () => {
        const vm = new ReactionsRowButtonViewModel(createProps({ disabled: true }));

        vm.onClick();

        expect(client.redactEvent).not.toHaveBeenCalled();
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(dis.dispatch).not.toHaveBeenCalled();
    });

    // Haven: regression test - same clobbering bug as ReactionsRowButtonTooltipViewModel's own
    // identical loop (this one feeds the button's aria-label instead of the tooltip caption). Keeps
    // the first reactor's shortcode rather than letting a later reactor's event, which lacks the
    // metadata, clobber one already found.
    it("keeps the first reactor's shortcode in the aria-label when a later reactor's event lacks it", () => {
        const firstReaction = createReactionEvent("@alice:example.org", "mxc://example.org/reaction");
        firstReaction.getContent()["com.beeper.reaction.shortcode"] = "party";
        const laterReaction = createReactionEvent("@bob:example.org", "mxc://example.org/reaction"); // no shortcode

        const vm = new ReactionsRowButtonViewModel(
            createProps({
                content: "mxc://example.org/reaction",
                reactionEvents: [firstReaction, laterReaction],
                customReactionImagesEnabled: true,
            }),
        );

        expect(getAriaLabel(vm)).toContain("reacted with party");
        expect(vm.getSnapshot().imageAlt).toBe("party");
    });

    describe("onContextMenu", () => {
        it("opens ReactionsDialog with the full Relations and this button's own content pre-selected", () => {
            const reactions = {} as Relations;
            const vm = new ReactionsRowButtonViewModel(createProps({ reactions }));

            vm.onContextMenu();

            expect(Modal.createDialog).toHaveBeenCalledWith(
                ReactionsDialog,
                { mxEvent, reactions, initialContent: "👍" },
                "mx_ReactionsDialog_wrapper",
            );
        });

        it("does nothing when no Relations were threaded through", () => {
            const vm = new ReactionsRowButtonViewModel(createProps({ reactions: undefined }));

            vm.onContextMenu();

            expect(Modal.createDialog).not.toHaveBeenCalled();
        });
    });

    describe("setReactions", () => {
        it("updates the reactions used by a later onContextMenu, without notifying subscribers", () => {
            const vm = new ReactionsRowButtonViewModel(createProps({ reactions: undefined }));
            const listener = vi.fn();
            vm.subscribe(listener);
            const reactions = {} as Relations;

            vm.setReactions(reactions);

            expect(listener).not.toHaveBeenCalled();

            vm.onContextMenu();

            expect(Modal.createDialog).toHaveBeenCalledWith(
                ReactionsDialog,
                { mxEvent, reactions, initialContent: "👍" },
                "mx_ReactionsDialog_wrapper",
            );
        });
    });
});
