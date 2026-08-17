/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import classNames from "classnames";
import React, { type JSX, useCallback, useContext, useEffect, useState } from "react";
import { ReactionIcon, StickerIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { type Room, type IEventRelation, type IContent, THREAD_RELATION_TYPE, EventType } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import ContextMenu, { aboveLeftOf, type MenuProps, useContextMenu } from "../../structures/ContextMenu";
import { HavenEmojiPicker } from "../../../emojipicker/HavenEmojiPicker";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";
import { useSettingValue } from "../../../hooks/useSettings";
import { type CustomEmojiChoice } from "../emojipicker/customEmoji";
import { CollapsibleButton, OverflowMenuContext } from "./CollapsibleButton";
import { doMaybeLocalRoomAction } from "../../../utils/local-room";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { IMAGE_SOURCE_PACKS_KEY, buildImageSourcePacks } from "../../../utils/imageSourcePacks";
import { useScopedRoomContext } from "../../../contexts/ScopedRoomContext";
import { addReplyToMessageContent } from "../../../utils/Reply";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type FocusComposerPayload } from "../../../dispatcher/payloads/FocusComposerPayload";

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
    /**
     * Haven: bumped by SendMessageComposer.tsx's own KeyBindingAction.ShowStickerPicker handling
     * (via MessageComposer.tsx/MessageComposerButtons.tsx) each time the "Send a Sticker" keyboard
     * shortcut fires - opens this popup straight to the Stickers tab (search box focused, same as a
     * normal mouse-opened Stickers tab - see EmojiPicker.tsx's own onKeyDown for how Tab from there
     * jumps to the first sticker). If the Stickers tab is already open, this closes it instead,
     * so repeatedly pressing the shortcut toggles it open and closed (see the effect below). A
     * plain increasing counter rather than a boolean so pressing the shortcut again while already
     * open on the Emoji tab still re-triggers the effect below to switch back to Stickers rather
     * than closing - a boolean toggled true would only fire once until it next went false, which
     * happens on close, not on every press. 0/undefined means "never requested" and deliberately
     * does nothing on mount (falsy), so this never fires from a stale default before any real
     * keyboard invocation has happened.
     */
    openStickerTabRequestId?: number;
}

type PickerTab = "emoji" | "sticker";

export function EmojiButton({
    addEmoji,
    menuPosition,
    className,
    room,
    relation,
    disableCustomEmoji,
    openStickerTabRequestId,
}: IEmojiButtonProps): JSX.Element {
    const overflowMenuCloser = useContext(OverflowMenuContext);
    const [menuDisplayed, button, openMenu, closeMenu] = useContextMenu();
    // Haven: see Settings.tsx's own doc for Haven.disableCustomEmojiPicker - when set, this button
    // drops straight to the plain stock picker below, skipping the Emoji/Sticker tab switcher
    // entirely (stock Element has no sticker tab here at all - it's this app's own addition).
    const customPickerDisabled = useSettingValue("Haven.disableCustomEmojiPicker");
    // Haven: see ReactionPicker.tsx's own identical onChoosePlain doc - EmojiPickerWithRecents
    // always calls onChoose with the picked PickerEmoji as the second argument, never a
    // CustomEmojiChoice (addEmoji's own second parameter type), since this picker has no pack data
    // to produce one from. Dropping that argument here is what makes addEmoji reliably treat every
    // pick as plain unicode instead of misreading the wrong shape as a custom emoji.
    const onChoosePlain = useCallback((unicode: string): boolean => addEmoji(unicode), [addEmoji]);
    // Haven: same source RoomUploadViewModel's own provider reads these from - lets a sticker sent
    // while replying to something carry that reply relation (see onChooseSticker below), and clear
    // the "Replying" box afterward, the same as sending a text message or an attachment already
    // does. Not plumbed through as props (unlike `room`/`relation` above) since this component was
    // never given them and every other composer action already reaches for context directly here.
    const { replyToEvent, timelineRenderingType } = useScopedRoomContext("replyToEvent", "timelineRenderingType");
    // Haven: which of the composer-only Emoji/Stickers tabs is active - always starts on Emoji.
    // Not meaningful for ReactionPicker.tsx's own separate EmojiPicker usage (stickers can never
    // be reactions - see EmojiPicker's IProps.mode doc), which is why this tab switcher lives here
    // rather than inside EmojiPicker itself.
    const [activeTab, setActiveTab] = useState<PickerTab>("emoji");

    useEffect(() => {
        if (!openStickerTabRequestId) return;
        if (menuDisplayed && activeTab === "sticker") {
            // Haven: the picker's already open and showing Stickers - toggle it closed instead of
            // just re-opening to the same tab, so repeatedly pressing the shortcut opens and closes
            // it. onFinished (not closeMenu directly) so this also returns focus to the composer,
            // same as any other way of closing this popup.
            onFinished();
            return;
        }
        setActiveTab("sticker");
        openMenu();
        // menuDisplayed/activeTab/openMenu/onFinished all get a new identity or value on every
        // render, not just when openStickerTabRequestId itself changes - including them here would
        // re-fire this effect (and so re-force/re-close the Stickers tab) on any unrelated re-render
        // of this component while openStickerTabRequestId is still sitting at its last-bumped value,
        // fighting a manual switch back to the Emoji tab the moment anything else (e.g. typing in the
        // composer) triggers a re-render. The values read above are still always this render's
        // latest by the time the effect actually runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openStickerTabRequestId]);

    const onFinished = useCallback((): void => {
        closeMenu();
        overflowMenuCloser?.();
        // Haven: without this, closing the popup (Escape, click-outside, or switching away without
        // picking anything) leaves real DOM focus wherever FocusLock's own `returnFocus` puts it -
        // this button itself, not the composer - since only actually choosing an emoji/sticker
        // re-focuses the composer as a side effect of inserting it (see addEmoji's own
        // Action.ComposerInsert dispatch). Left alone, that stranded focus on this button was silently
        // eating the next "Send a Sticker" keyboard shortcut press: SendMessageComposer's own
        // onKeyDown only fires for keydowns bubbling through its own composer div, which this button
        // sits outside of. Dispatching this (matching ReactionPicker.tsx's own identical pattern)
        // always lands focus back in the composer on close, regardless of how the popup was opened
        // or closed.
        dis.dispatch<FocusComposerPayload>({
            action: Action.FocusAComposer,
            context: timelineRenderingType,
        });
    }, [closeMenu, overflowMenuCloser, timelineRenderingType]);

    // Haven: the openStickerTabRequestId effect above only sees a *fresh* keyboard shortcut press -
    // once the popup is open, real DOM focus (and so the keydown itself) is inside this popup's own
    // portal-rendered subtree (the search box, autofocused), never the composer's own div that
    // SendMessageComposer's onKeyDown listens on. Without this, pressing the shortcut again while
    // the popup is open and focused did nothing at all, since the event never reached the code that
    // bumps openStickerTabRequestId in the first place. Listening for the same action here, scoped
    // to just this popup, closes it on a second press regardless of which control inside currently
    // has focus - matching the same "Send a Sticker" shortcut as the composer's own handling.
    const onPickerKeyDown = useCallback(
        (ev: React.KeyboardEvent): void => {
            if (
                activeTab === "sticker" &&
                getKeyBindingsManager().getMessageComposerAction(ev) === KeyBindingAction.ShowStickerPicker
            ) {
                onFinished();
                ev.preventDefault();
                ev.stopPropagation();
            }
        },
        [activeTab, onFinished],
    );

    // Haven: sends the chosen pack image directly as a real m.sticker event - bypasses the stock
    // integration-manager widget pipeline (Stickerpicker.tsx) entirely, since every entry shown in
    // "sticker" mode is already one of this room's/the user's own MSC2545 packs, not a
    // widget-provided catalog. Every choice here always carries `custom` (mode="sticker" never
    // shows real unicode emoji - see EmojiPicker's own constructor), so no unicode fallback path
    // is needed. Sent directly via matrixClient.sendEvent rather than
    // ContentMessages.sendStickerContentToRoom, since that helper's own sendStickerMessage call
    // has no way to attach the extra MSC4459 image_source_packs field - doMaybeLocalRoomAction is
    // still used directly to keep the same local-room (not-yet-created DM) handling that helper had.
    //
    // If the composer has an active reply target, the sticker needs to carry that same
    // m.in_reply_to relation a normal reply message/attachment would (see SendMessageComposer.tsx/
    // ContentMessages.sendContentListToRoom's own identical addReplyToMessageContent calls) - without
    // this, choosing a sticker while "Replying to X" was showing sent the sticker as an unrelated,
    // un-threaded event and then left that reply banner sitting above the composer afterward, since
    // nothing had ever told RoomViewStore the reply was actually acted on.
    const onChooseSticker = useCallback(
        (_value: string, custom?: CustomEmojiChoice): boolean => {
            if (!custom || !room) return false;
            const threadId = relation?.rel_type === THREAD_RELATION_TYPE.name ? (relation.event_id ?? null) : null;
            const imageSourcePacks = buildImageSourcePacks(custom.mxcUrl, room, custom.stateKey, custom.shortcode);
            const content: IContent = {
                body: custom.shortcode,
                url: custom.mxcUrl,
                info: custom.imageInfo ?? {},
                ...(Object.keys(imageSourcePacks).length > 0 ? { [IMAGE_SOURCE_PACKS_KEY]: imageSourcePacks } : {}),
            };
            if (replyToEvent) addReplyToMessageContent(content, replyToEvent);
            void doMaybeLocalRoomAction(
                room.roomId,
                (actualRoomId: string) =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    room.client.sendEvent(actualRoomId, threadId, EventType.Sticker, content as any),
                room.client,
            );
            if (replyToEvent) {
                // Clear the reply target now that it's been attached above - mirrors
                // SendMessageComposer.tsx/ContentMessages.sendContentListToRoom's own identical
                // dispatch once their own send is under way, not awaited first.
                dis.dispatch({
                    action: "reply_to_event",
                    event: null,
                    context: timelineRenderingType,
                });
            }
            onFinished();
            return true;
        },
        [room, relation, onFinished, replyToEvent, timelineRenderingType],
    );

    let contextMenu: React.ReactElement | null = null;
    if (menuDisplayed && button.current) {
        // Haven: `menuPosition`, when set, comes from MessageComposer's own getMenuPosition() -
        // computed synchronously during ITS render, which reads the composer's bounding rect as of
        // the *previous* commit (React hasn't painted this render's own DOM changes yet at that
        // point). That's stale by exactly one render whenever something shifts the composer's own
        // layout (e.g. the reply-preview banner appearing) and nothing forces MessageComposer to
        // re-render again afterward before this button gets clicked - since opening/closing this
        // popup only touches EmojiButton's own local state, not any prop MessageComposer reads, it
        // can go on using that first stale value indefinitely. That showed up as the emoji/sticker
        // popup opening far from this button - sometimes covering the reply banner it should be
        // sitting below - any time this was opened while a reply was active. Computing fresh off
        // this button's own ref instead sidesteps the staleness entirely - correct except inside
        // the composer's collapsed "..." overflow menu (overflowMenuCloser set), where this button
        // has no on-screen position of its own yet to measure and `menuPosition` (anchored to the
        // overflow trigger instead) is the only sensible source.
        const position = overflowMenuCloser
            ? (menuPosition ?? aboveLeftOf(button.current.getBoundingClientRect()))
            : aboveLeftOf(button.current.getBoundingClientRect());

        contextMenu = (
            <ContextMenu {...position} onFinished={onFinished} managed={false} focusLock>
                <div className="mx_EmojiButton_picker" onKeyDown={onPickerKeyDown}>
                    {customPickerDisabled ? (
                        <EmojiPickerWithRecents onChoose={onChoosePlain} onFinished={onFinished} />
                    ) : (
                        <>
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
                            {/* Haven: keyed by tab so switching mode always starts the newly-shown
                                picker (search filter, scroll position, roving focus) fresh rather
                                than carrying over whatever state the other tab's picker was left
                                in. */}
                            {activeTab === "emoji" ? (
                                <HavenEmojiPicker
                                    key="emoji"
                                    onChoose={addEmoji}
                                    onFinished={onFinished}
                                    room={room}
                                    mode="emoji"
                                    disableCustomEmoji={disableCustomEmoji}
                                />
                            ) : (
                                <HavenEmojiPicker
                                    key="sticker"
                                    onChoose={onChooseSticker}
                                    onFinished={onFinished}
                                    room={room}
                                    mode="sticker"
                                />
                            )}
                        </>
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
