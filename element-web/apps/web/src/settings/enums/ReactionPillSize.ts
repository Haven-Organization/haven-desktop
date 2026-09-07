/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Haven: controls the size of reaction pills (the emoji/pack-image/freeform-text buttons shown
 * under a message or Social post) - see ReactionsRowButton.module.css's own doc for the exact
 * dimensions each size maps to, and why Large exists as the default at all (it's Haven's own
 * bump over stock Element's original, more cramped size).
 */
export enum ReactionPillSize {
    Normal = "normal",
    Large = "large",
}
