/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type RefObject, useMemo, type ReactNode } from "react";
import { type IEventRelation, type Room } from "matrix-js-sdk/src/matrix";
import LockOffIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock-off";

import { useWysiwygSendActionHandler } from "./hooks/useWysiwygSendActionHandler";
import { WysiwygComposer } from "./components/WysiwygComposer";
import { PlainTextComposer } from "./components/PlainTextComposer";
import { type ComposerFunctions } from "./types";
import { E2EStatus } from "../../../../utils/ShieldUtils";
import E2EIcon from "../E2EIcon";
import { type MenuProps } from "../../../structures/ContextMenu";
import { Emoji } from "./components/Emoji";
import { ComposerContext, getDefaultContextValue } from "./ComposerContext";

interface ContentProps {
    disabled?: boolean;
    composerFunctions: ComposerFunctions;
    ref?: RefObject<HTMLElement | null>;
}

const Content = function Content({ disabled = false, composerFunctions, ref }: ContentProps): ReactNode {
    useWysiwygSendActionHandler(disabled, ref, composerFunctions);
    return null;
};

export interface SendWysiwygComposerProps {
    initialContent?: string;
    isRichTextEnabled: boolean;
    placeholder?: string;
    disabled?: boolean;
    e2eStatus?: E2EStatus;
    onChange: (content: string) => void;
    onSend: () => void;
    menuPosition: MenuProps;
    eventRelation?: IEventRelation;
    /** Haven: threaded through to Emoji.tsx's own EmojiButton so it can show this room's own
     *  MSC2545 custom emoji/sticker packs - see EmojiButton.tsx's own doc on why it needs a room.
     *  The plain-composer path (SendMessageComposer.tsx/MessageComposerButtons.tsx) already had
     *  this; the rich-text path never did, so custom packs silently came up empty (no categories,
     *  "This room has no stickers") whenever the Rich Text Editor lab was on - confirmed live
     *  2026-07-22. */
    room?: Room;
}

// Default needed for React.lazy
export default function SendWysiwygComposer({
    isRichTextEnabled,
    e2eStatus,
    menuPosition,
    room,
    ...props
}: SendWysiwygComposerProps): JSX.Element {
    const Composer = isRichTextEnabled ? WysiwygComposer : PlainTextComposer;
    const defaultContextValue = useMemo(
        () => getDefaultContextValue({ eventRelation: props.eventRelation }),
        [props.eventRelation],
    );

    let leftIcon: false | JSX.Element = false;
    if (!e2eStatus) {
        leftIcon = (
            <LockOffIcon
                data-testid="e2e-icon"
                width={12}
                height={12}
                color="var(--cpd-color-icon-info-primary)"
                className="mx_E2EIcon"
            />
        );
    } else if (e2eStatus !== E2EStatus.Normal) {
        leftIcon = <E2EIcon status={e2eStatus} size={12} />;
    }
    return (
        <ComposerContext.Provider value={defaultContextValue}>
            <Composer
                className="mx_SendWysiwygComposer"
                leftComponent={leftIcon}
                rightComponent={
                    // Haven: disableCustomEmoji only applies to WysiwygComposer (true rich text) -
                    // PlainTextComposer's own insertText is a raw innerHTML splice (see
                    // useComposerFunctions.ts), which happens to render an inline <img> correctly
                    // if the text ever contained one, unlike WysiwygComposer's rust-model-backed
                    // insertText, which only ever inserts literal escaped text - see Emoji.tsx's
                    // own doc.
                    <Emoji menuPosition={menuPosition} room={room} disableCustomEmoji={isRichTextEnabled} />
                }
                {...props}
            >
                {(ref, composerFunctions) => (
                    <Content disabled={props.disabled} ref={ref} composerFunctions={composerFunctions} />
                )}
            </Composer>
        </ComposerContext.Provider>
    );
}
