/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient, mkStubRoom } from "test-utils";

import { HavenEmojiPicker } from "./HavenEmojiPicker";
import { makeCustomEmoji } from "../components/views/emojipicker/customEmoji";
import * as ImagePacks from "../utils/ImagePacks";
import * as animCache from "../utils/PackImageAnimationCache";
import { consumePendingManagePackStateKey } from "../utils/pendingManagePack";
import dis from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import * as recent from "./recent";

vi.mock("../dispatcher/dispatcher");

let capturedProps: any;
vi.mock("@element-hq/web-shared-components", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@element-hq/web-shared-components")>();
    return {
        ...actual,
        EmojiPicker: (props: any) => {
            capturedProps = props;
            return <div data-testid="shared-emoji-picker">{props.belowSearch}</div>;
        },
    };
});

function makePack(overrides: Partial<ImagePacks.RoomImagePack> = {}): ImagePacks.RoomImagePack {
    return {
        roomId: "!pack-room:example.org",
        stateKey: "packA",
        content: { pack: { display_name: "Party Pack" }, images: {} },
        ...overrides,
    } as unknown as ImagePacks.RoomImagePack;
}

// Haven: this is the wiring layer between the shared-components picker (which only knows a generic
// "extra categories with an image URL" shape) and this app's own MSC2545 image packs / MSC4459
// custom reactions - covers building pack categories for both emoji and sticker mode, the
// zero-packs empty states (each with its own manage-pack/settings links), disableCustomEmoji
// hiding packs, and translating a chosen pack emoji back into a CustomEmojiChoice.
describe("HavenEmojiPicker", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        vi.restoreAllMocks();
        capturedProps = undefined;
        client = stubClient();
        vi.spyOn(animCache, "useAnimatedImageCacheVersion").mockReturnValue(0);
        vi.spyOn(animCache, "getCachedPackImageAnimated").mockReturnValue(false);
        vi.spyOn(animCache, "ensurePackImageAnimatedChecked").mockImplementation(() => {});
    });

    it("builds one extra category per emoticon pack, with images resolved via imagesForUsage", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const pack = makePack();
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        vi.spyOn(ImagePacks, "packDisplayName").mockReturnValue("Party Pack");
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "imagesForUsage").mockReturnValue([
            { shortcode: "tada", image: { url: "mxc://example.org/tada", body: "tada" } } as never,
        ]);

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} room={room} />);

        expect(capturedProps.extraCategories).toHaveLength(1);
        const category = capturedProps.extraCategories[0];
        expect(category.id).toBe(`pack:${pack.roomId}:${pack.stateKey}`);
        expect(category.name).toBe("Party Pack");
        expect(category.manageRoomId).toBe(pack.roomId);
        expect(category.manageStateKey).toBe(pack.stateKey);

        const items = capturedProps.dataByExtraCategory[category.id];
        expect(items).toHaveLength(1);
        expect(items[0].shortcodes).toEqual(["tada"]);
    });

    it("offers a create-pack empty-state category in emoji mode when the room has no packs but is manageable", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} room={room} />);

        expect(capturedProps.extraCategories).toHaveLength(1);
        expect(capturedProps.extraCategories[0].id).toBe(`pack-create:${room.roomId}`);
        expect(capturedProps.dataByExtraCategory[`pack-create:${room.roomId}`]).toEqual([]);
    });

    it("hides pack categories entirely when disableCustomEmoji is set (emoji mode only)", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const getEmoticonPacks = vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([makePack()]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([makePack()]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(false);

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} room={room} disableCustomEmoji />);

        expect(capturedProps.extraCategories).toEqual([]);
        expect(getEmoticonPacks).not.toHaveBeenCalled();
    });

    it("uses sticker packs as stickerCategories in sticker mode, not extraCategories", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const pack = makePack();
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        vi.spyOn(ImagePacks, "packDisplayName").mockReturnValue("Party Pack");
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "imagesForUsage").mockReturnValue([]);

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} room={room} mode="sticker" />);

        expect(capturedProps.extraCategories).toBeUndefined();
        expect(capturedProps.stickerCategories).toHaveLength(1);
        expect(capturedProps.stickerCategories[0].id).toBe(`pack:${pack.roomId}:${pack.stateKey}`);
    });

    it("synthesizes a no-stickers empty state in sticker mode when the room has zero sticker packs", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(false);

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} room={room} mode="sticker" />);

        expect(capturedProps.stickerCategories).toHaveLength(1);
        expect(capturedProps.stickerCategories[0].isEmptyState).toBe(true);
        expect(capturedProps.dataByStickerCategory[capturedProps.stickerCategories[0].id]).toEqual([]);
    });

    it("passes a plain unicode choice straight through to onChoose", () => {
        const onChoose = vi.fn();
        render(<HavenEmojiPicker onChoose={onChoose} onFinished={vi.fn()} />);

        capturedProps.onChoose("👍", { unicode: "👍" });

        expect(onChoose).toHaveBeenCalledWith("👍");
    });

    it("translates a chosen custom pack emoji into a CustomEmojiChoice", () => {
        const onChoose = vi.fn();
        render(<HavenEmojiPicker onChoose={onChoose} onFinished={vi.fn()} />);

        const custom = makeCustomEmoji("tada", "mxc://example.org/tada", "Party Pack", "!room:example.org", "packA");
        capturedProps.onChoose(":tada:", custom);

        expect(onChoose).toHaveBeenCalledWith(":tada:", {
            shortcode: "tada",
            mxcUrl: "mxc://example.org/tada",
            packName: "Party Pack",
            roomId: "!room:example.org",
            stateKey: "packA",
            imageInfo: undefined,
        });
    });

    it("sends a freeform reaction from the search filter and records it as recent", async () => {
        const onChoose = vi.fn().mockReturnValue(true);
        const onFinished = vi.fn();
        const addRecent = vi.spyOn(recent, "add").mockImplementation(() => {});
        vi.spyOn(recent, "get").mockReturnValue([]);

        render(<HavenEmojiPicker onChoose={onChoose} onFinished={onFinished} allowFreeformReaction />);
        act(() => capturedProps.onFilterChange("myword"));

        expect(screen.queryByText('React with "myword"')).not.toBeNull();
        await userEvent.click(screen.getByText('React with "myword"'));

        expect(onChoose).toHaveBeenCalledWith("myword");
        expect(addRecent).toHaveBeenCalledWith("myword");
        expect(onFinished).toHaveBeenCalled();
    });

    it("does not offer freeform reaction UI when allowFreeformReaction is unset", () => {
        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);
        act(() => capturedProps.onFilterChange("myword"));

        expect(screen.queryByText('React with "myword"')).toBeNull();
    });

    it("routes the sticker empty-state's manage link to open_room_settings with this room, no pending state key", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        const onFinished = vi.fn();

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={onFinished} room={room} mode="sticker" />);
        render(<>{capturedProps.renderEmptyStateCategory({})}</>);

        await userEvent.click(screen.getByText("Create New Pack"));

        expect(onFinished).toHaveBeenCalled();
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: "open_room_settings",
            room_id: room.roomId,
            initial_tab_id: "ROOM_EMOJI_STICKERS_TAB",
        });
        expect(consumePendingManagePackStateKey()).toBeNull();
    });

    it("routes the sticker empty-state's settings link to onOpenSettings when the viewer can't manage packs", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "getEmoticonPacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([]);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(false);
        const onFinished = vi.fn();

        render(<HavenEmojiPicker onChoose={vi.fn()} onFinished={onFinished} room={room} mode="sticker" />);
        render(<>{capturedProps.renderEmptyStateCategory({})}</>);

        await userEvent.click(screen.getByText("Favorite Packs"));

        expect(onFinished).toHaveBeenCalled();
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: Action.ViewUserSettings,
            initialTabId: "USER_EMOJI_STICKERS_TAB",
        });
    });
});
