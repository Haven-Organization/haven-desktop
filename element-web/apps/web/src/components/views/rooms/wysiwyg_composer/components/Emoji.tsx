/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { type MenuProps } from "../../../../structures/ContextMenu";
import { EmojiButton } from "../../EmojiButton";
import dis from "../../../../../dispatcher/dispatcher";
import { type ComposerInsertPayload } from "../../../../../dispatcher/payloads/ComposerInsertPayload";
import { Action } from "../../../../../dispatcher/actions";
import { useScopedRoomContext } from "../../../../../contexts/ScopedRoomContext.tsx";

interface EmojiProps {
    menuPosition: MenuProps;
    /** Haven: forwarded from SendWysiwygComposer.tsx's own identical prop - see its doc. */
    room?: Room;
    /** Haven: true only for the real rich-text editor (WysiwygComposer), not the plain-text one
     *  within this same lab (PlainTextComposer) - see SendWysiwygComposer.tsx's own doc on why
     *  only the former needs this. Hides this room's own custom emoji packs from the picker
     *  entirely - see EmojiPicker's own disableCustomEmoji doc for why. */
    disableCustomEmoji?: boolean;
}

export function Emoji({ menuPosition, room, disableCustomEmoji }: EmojiProps): JSX.Element {
    const roomContext = useScopedRoomContext("timelineRenderingType");

    return (
        <EmojiButton
            menuPosition={menuPosition}
            room={room}
            disableCustomEmoji={disableCustomEmoji}
            addEmoji={(emoji, custom) => {
                dis.dispatch<ComposerInsertPayload>(
                    // Haven: mirrors MessageComposer.tsx's own addEmoji - a custom (MSC2545 pack)
                    // emoji gets its own payload shape so the receiving composer can tell it apart
                    // from a real unicode one. See useWysiwygSendActionHandler.ts's own handling of
                    // payload.customEmoji for why the rich-text editor can't render this as an
                    // inline image the way the plain composer's CustomEmojiPart does.
                    custom
                        ? {
                              action: Action.ComposerInsert,
                              customEmoji: custom,
                              timelineRenderingType: roomContext.timelineRenderingType,
                          }
                        : {
                              action: Action.ComposerInsert,
                              text: emoji,
                              timelineRenderingType: roomContext.timelineRenderingType,
                          },
                );
                return true;
            }}
        />
    );
}
