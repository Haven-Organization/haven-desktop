/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

export const CATEGORY_HEADER_HEIGHT = 20;
export const EMOJI_HEIGHT = 35;
export const EMOJIS_PER_ROW = 8;
// Haven: stickers get a visibly bigger grid slot than emoji - same row width (304px, see
// _EmojiPicker.pcss's own doc on that figure), just 4 wider cells instead of 8 narrower ones, at
// roughly the same width:height ratio as the emoji grid's own 38:35.
export const STICKER_HEIGHT = 70;
export const STICKERS_PER_ROW = 4;
