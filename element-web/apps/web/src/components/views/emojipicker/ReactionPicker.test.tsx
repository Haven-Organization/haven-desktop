/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "test-utils-rtl";
import { EventType, RelationType } from "matrix-js-sdk/src/matrix";
import { stubClient, mkEvent, mkStubRoom } from "test-utils";

import ReactionPicker from "./ReactionPicker";
import { type CustomEmojiChoice } from "./customEmoji";
import RoomContext, { type RoomContextType } from "../../../contexts/RoomContext";
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import SettingsStore from "../../../settings/SettingsStore";
import * as imageSourcePacks from "../../../utils/imageSourcePacks";
import dis from "../../../dispatcher/dispatcher";
import * as recent from "../../../emojipicker/recent";

vi.mock("../../../dispatcher/dispatcher");

let havenPickerProps: any;
vi.mock("../../../emojipicker/HavenEmojiPicker", () => ({
    HavenEmojiPicker: (props: any) => {
        havenPickerProps = props;
        return <div data-testid="haven-picker" />;
    },
}));

let stockPickerProps: any;
vi.mock("../../../emojipicker/EmojiPickerWithRecents", () => ({
    EmojiPickerWithRecents: (props: any) => {
        stockPickerProps = props;
        return <div data-testid="stock-picker" />;
    },
}));

function renderPicker(props: Partial<React.ComponentProps<typeof ReactionPicker>> = {}, canSelfRedact = true) {
    const mxEvent = props.mxEvent ?? mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} });
    const contextValue = { canSelfRedact, timelineRenderingType: TimelineRenderingType.Room } as unknown as RoomContextType;
    return render(
        <RoomContext.Provider value={contextValue}>
            <ReactionPicker mxEvent={mxEvent} onFinished={vi.fn()} {...props} />
        </RoomContext.Provider>,
    );
}

// Haven: ReactionPicker is the glue between the emoji picker (stock or Haven's own pack-aware
// picker, gated by Haven.disableCustomEmojiPicker) and actually sending/redacting a reaction -
// covers both the plain-unicode and custom-pack-emoji send paths, the reclick-to-remove toggle
// (gated on canSelfRedact), and the freeform-text reaction fallback that survives even with the
// custom picker disabled.
describe("ReactionPicker", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        havenPickerProps = undefined;
        stockPickerProps = undefined;
        client = stubClient();
        client.sendEvent = vi.fn().mockResolvedValue({ event_id: "$sent" });
        client.redactEvent = vi.fn().mockResolvedValue({ event_id: "$redacted" });
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(false);
        vi.spyOn(recent, "add").mockImplementation(() => {});
    });

    it("renders HavenEmojiPicker with allowFreeformReaction when the custom picker isn't disabled", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        client.getRoom = vi.fn().mockReturnValue(room);
        renderPicker();

        expect(screen.getByTestId("haven-picker")).toBeInTheDocument();
        expect(havenPickerProps.allowFreeformReaction).toBe(true);
        expect(havenPickerProps.room).toBe(room);
    });

    it("renders the stock picker when Haven.disableCustomEmojiPicker is set", () => {
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(true);
        renderPicker();

        expect(screen.getByTestId("stock-picker")).toBeInTheDocument();
        expect(havenPickerProps).toBeUndefined();
    });

    it("sends a plain unicode reaction and finishes", () => {
        const onFinished = vi.fn();
        const mxEvent = mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} });
        renderPicker({ mxEvent, onFinished });

        const result = havenPickerProps.onChoose("👍");

        expect(result).toBe(true);
        expect(client.sendEvent).toHaveBeenCalledWith(
            mxEvent.getRoomId(),
            EventType.Reaction,
            expect.objectContaining({
                "m.relates_to": expect.objectContaining({
                    rel_type: RelationType.Annotation,
                    event_id: mxEvent.getId(),
                    key: "👍",
                }),
            }),
        );
        expect(onFinished).toHaveBeenCalled();
        expect(dis.dispatch).toHaveBeenCalledWith({ action: "message_sent" });
    });

    it("calls onReact after sending a new reaction", () => {
        const onReact = vi.fn();
        renderPicker({ onReact });

        havenPickerProps.onChoose("👍");

        expect(onReact).toHaveBeenCalled();
    });

    it("redacts an existing own reaction on reclick when self-redact is allowed", () => {
        const mxEvent = mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} });
        const myReaction = mkEvent({
            event: true,
            type: "m.reaction",
            room: "!room:example.org",
            user: client.getSafeUserId(),
            content: { "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId(), key: "👍" } },
        });
        const relations = {
            getAnnotationsBySender: () => ({ [client.getSafeUserId()]: new Set([myReaction]) }),
            on: vi.fn(),
            removeListener: vi.fn(),
        } as unknown as import("matrix-js-sdk/src/matrix").Relations;

        renderPicker({ mxEvent, reactions: relations }, true);

        const result = havenPickerProps.onChoose("👍");

        expect(result).toBe(false);
        expect(client.redactEvent).toHaveBeenCalledWith(mxEvent.getRoomId(), myReaction.getId());
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("does not redact an existing own reaction when self-redact is not allowed", () => {
        const mxEvent = mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} });
        const myReaction = mkEvent({
            event: true,
            type: "m.reaction",
            room: "!room:example.org",
            user: client.getSafeUserId(),
            content: { "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId(), key: "👍" } },
        });
        const relations = {
            getAnnotationsBySender: () => ({ [client.getSafeUserId()]: new Set([myReaction]) }),
            on: vi.fn(),
            removeListener: vi.fn(),
        } as unknown as import("matrix-js-sdk/src/matrix").Relations;

        renderPicker({ mxEvent, reactions: relations }, false);

        havenPickerProps.onChoose("👍");

        expect(client.redactEvent).not.toHaveBeenCalled();
    });

    it("sends a custom emoji reaction keyed by its mxc:// URL, with the shortcode and image source packs attached", () => {
        const mxEvent = mkEvent({ event: true, type: "m.room.message", room: "!room:example.org", user: "@alice:example.org", content: {} });
        const sourceRoom = mkStubRoom("!source:example.org", "Source Room", client);
        client.getRoom = vi.fn((id: string) => (id === "!source:example.org" ? sourceRoom : null));
        vi.spyOn(imageSourcePacks, "buildImageSourcePacks").mockReturnValue({
            "mxc://example.org/emoji": { rooms: { "!source:example.org": { "packA": [] } } },
        } as never);

        renderPicker({ mxEvent });

        const custom: CustomEmojiChoice = {
            shortcode: "party",
            mxcUrl: "mxc://example.org/emoji",
            packName: "Party Pack",
            roomId: "!source:example.org",
            stateKey: "packA",
        };
        havenPickerProps.onChoose("mxc://example.org/emoji", custom);

        expect(client.sendEvent).toHaveBeenCalledWith(
            mxEvent.getRoomId(),
            EventType.Reaction,
            expect.objectContaining({
                "m.relates_to": expect.objectContaining({ key: "mxc://example.org/emoji" }),
                "com.beeper.reaction.shortcode": ":party:",
                "com.beeper.msc4459.image_source_packs": expect.any(Object),
            }),
        );
    });

    it("sends a freeform-text reaction and records it as recent when the stock picker is used", async () => {
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(true);
        renderPicker();

        act(() => stockPickerProps.onFilterChange("myword"));
        stockPickerProps.onFreeformEnter();

        expect(client.sendEvent).toHaveBeenCalledWith(
            expect.any(String),
            EventType.Reaction,
            expect.objectContaining({ "m.relates_to": expect.objectContaining({ key: "myword" }) }),
        );
    });
});
