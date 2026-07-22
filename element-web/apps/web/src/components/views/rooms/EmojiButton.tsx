/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import classNames from "classnames";
import React, { type JSX, useCallback, useContext, useState } from "react";
import { ReactionIcon, StickerIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { type Room, type IEventRelation, THREAD_RELATION_TYPE, EventType } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import ContextMenu, { aboveLeftOf, type MenuProps, useContextMenu } from "../../structures/ContextMenu";
import EmojiPicker from "../emojipicker/EmojiPicker";
import { type CustomEmojiChoice } from "../emojipicker/customEmoji";
import { CollapsibleButton, OverflowMenuContext } from "./CollapsibleButton";
import { doMaybeLocalRoomAction } from "../../../utils/local-room";
import { IMAGE_SOURCE_PACKS_KEY, buildImageSourcePacks } from "../../../utils/imageSourcePacks";

interface IEmojiButtonProps {
    addEmoji: (unicode: string, custom?: CustomEmojiChoice) => boolean;
    menuPosition?: MenuProps;
    className?: string;
    /** Haven: threaded through to EmojiPicker so it can show this room's own MSC2545 image packs
     *  (see MessageComposerButtons.tsx, the only current caller, which already has this via
     *  useScopedRoomContext). Also what a sticker actually gets sent into (see the Stickers tab
     *  below) - this button's Stickers tab has no meaning without a room to send into. */
    room?: Room;
    /** Haven: forwarded from MessageComposerButtons.tsx's own identical prop - if composing within
     *  a thread, a sent sticker should land in that same thread, same as any other composer
     *  action. */
    relation?: IEventRelation;
    /** Haven: forwarded to the Emoji-tab EmojiPicker's own identical prop - see its doc. Never
     *  applied to the Sticker tab, which doesn't have the problem this exists for. */
    disableCustomEmoji?: boolean;
}

type PickerTab = "emoji" | "sticker";

export function EmojiButton({
    addEmoji,
    menuPosition,
    className,
    room,
    relation,
    disableCustomEmoji,
}: IEmojiButtonProps): JSX.Element {
    const overflowMenuCloser = useContext(OverflowMenuContext);
    const [menuDisplayed, button, openMenu, closeMenu] = useContextMenu();
    // Haven: which of the composer-only Emoji/Stickers tabs is active - always starts on Emoji.
    // Not meaningful for ReactionPicker.tsx's own separate EmojiPicker usage (stickers can never
    // be reactions - see EmojiPicker's IProps.mode doc), which is why this tab switcher lives here
    // rather than inside EmojiPicker itself.
    const [activeTab, setActiveTab] = useState<PickerTab>("emoji");

    const onFinished = useCallback((): void => {
        closeMenu();
        overflowMenuCloser?.();
    }, [closeMenu, overflowMenuCloser]);

    // Haven: sends the chosen pack image directly as a real m.sticker event - bypasses the stock
    // integration-manager widget pipeline (Stickerpicker.tsx) entirely, since every entry shown in
    // "sticker" mode is already one of this room's/the user's own MSC2545 packs, not a
    // widget-provided catalog. Every choice here always carries `custom` (mode="sticker" never
    // shows real unicode emoji - see EmojiPicker's own constructor), so no unicode fallback path
    // is needed. Sent directly via matrixClient.sendEvent rather than
    // ContentMessages.sendStickerContentToRoom, since that helper's own sendStickerMessage call
    // has no way to attach the extra MSC4459 image_source_packs field - doMaybeLocalRoomAction is
    // still used directly to keep the same local-room (not-yet-created DM) handling that helper had.
    const onChooseSticker = useCallback(
        (_value: string, custom?: CustomEmojiChoice): boolean => {
            if (!custom || !room) return false;
            const threadId = relation?.rel_type === THREAD_RELATION_TYPE.name ? (relation.event_id ?? null) : null;
            const imageSourcePacks = buildImageSourcePacks(custom.mxcUrl, room, custom.stateKey, custom.shortcode);
            const content = {
                body: custom.shortcode,
                url: custom.mxcUrl,
                info: custom.imageInfo ?? {},
                ...(Object.keys(imageSourcePacks).length > 0 ? { [IMAGE_SOURCE_PACKS_KEY]: imageSourcePacks } : {}),
            };
            void doMaybeLocalRoomAction(
                room.roomId,
                (actualRoomId: string) =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    room.client.sendEvent(actualRoomId, threadId, EventType.Sticker, content as any),
                room.client,
            );
            onFinished();
            return true;
        },
        [room, relation, onFinished],
    );

    let contextMenu: React.ReactElement | null = null;
    if (menuDisplayed && button.current) {
        const position = menuPosition ?? aboveLeftOf(button.current.getBoundingClientRect());

        contextMenu = (
            <ContextMenu {...position} onFinished={onFinished} managed={false} focusLock>
                <div className="mx_EmojiButton_picker">
                    <div className="mx_EmojiButton_tabs" role="tablist">
                        <button
                            role="tab"
                            aria-selected={activeTab === "emoji"}
                            className={classNames("mx_EmojiButton_tab", {
                                mx_EmojiButton_tab_active: activeTab === "emoji",
                            })}
                            onClick={() => setActiveTab("emoji")}
                        >
                            <ReactionIcon />
                            {_t("composer|emoji_picker|emoji_tab")}
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeTab === "sticker"}
                            className={classNames("mx_EmojiButton_tab", {
                                mx_EmojiButton_tab_active: activeTab === "sticker",
                            })}
                            onClick={() => setActiveTab("sticker")}
                        >
                            <StickerIcon />
                            {_t("composer|emoji_picker|sticker_tab")}
                        </button>
                    </div>
                    {/* Haven: EmojiPicker is a class component that computes its categories/data
                        once in its constructor rather than reacting to prop changes, so switching
                        `mode` on an already-mounted instance would leave the old tab's categories
                        on screen - keying by activeTab forces a fresh mount instead. */}
                    {activeTab === "emoji" ? (
                        <EmojiPicker
                            key="emoji"
                            onChoose={addEmoji}
                            onFinished={onFinished}
                            room={room}
                            mode="emoji"
                            disableCustomEmoji={disableCustomEmoji}
                        />
                    ) : (
                        <EmojiPicker
                            key="sticker"
                            onChoose={onChooseSticker}
                            onFinished={onFinished}
                            room={room}
                            mode="sticker"
                        />
                    )}
                </div>
            </ContextMenu>
        );
    }

    const computedClassName = classNames("mx_EmojiButton", className, {
        mx_EmojiButton_highlight: menuDisplayed,
    });

    // TODO: replace ContextMenuTooltipButton with a unified representation of
    // the header buttons and the right panel buttons
    return (
        <>
            <CollapsibleButton
                className={computedClassName}
                onClick={openMenu}
                title={_t("common|emoji")}
                inputRef={button}
            >
                <ReactionIcon />
            </CollapsibleButton>

            {contextMenu}
        </>
    );
}
