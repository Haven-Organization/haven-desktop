/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Haven: which design the bundled Twemoji font draws for the 🔫 (U+1F52B) emoji. Twemoji itself
 * swapped its revolver for a water pistol in 2.6 (April 2018); the bundled font predates the
 * modern handgun that later landed in Twemoji's own repository. Purely a local rendering choice -
 * what's sent is always U+1F52B - and only takes effect while "Use bundled emoji font" is enabled.
 */
export enum GunEmojiStyle {
    /** The pre-2018 Twemoji revolver. */
    Revolver = "revolver",
    /** The modern pistol from Twemoji's repository. */
    Handgun = "handgun",
    /** What the bundled font itself draws (and every other platform's own emoji font does). */
    WaterPistol = "water-pistol",
}
