/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Emoji } from "@matrix-org/emojibase-bindings";

import { isCustomEmoji } from "./customEmoji";
import { MatrixClientPeg } from "../../../MatrixClientPeg";

interface IProps {
    emoji: Emoji;
}

class Preview extends React.PureComponent<IProps> {
    public render(): React.ReactNode {
        const {
            unicode,
            label,
            shortcodes: [shortcode],
        } = this.props.emoji;
        const custom = isCustomEmoji(this.props.emoji) ? this.props.emoji : undefined;

        return (
            <div className="mx_EmojiPicker_footer mx_EmojiPicker_preview">
                <div className="mx_EmojiPicker_preview_emoji">
                    {custom ? (
                        <img
                            className="mx_EmojiPicker_preview_customImg"
                            // Haven: no width/height/method - see Emoji.tsx's own identical doc,
                            // this must stay a /download/ to keep an animated source animated.
                            src={MatrixClientPeg.safeGet().mxcUrlToHttp(custom.mxcUrl) ?? undefined}
                            alt={label}
                        />
                    ) : (
                        unicode
                    )}
                </div>
                <div className="mx_EmojiPicker_preview_text">
                    <div className="mx_EmojiPicker_name mx_EmojiPicker_preview_name">{label}</div>
                    <div className="mx_EmojiPicker_shortcode">{shortcode}</div>
                </div>
            </div>
        );
    }
}

export default Preview;
