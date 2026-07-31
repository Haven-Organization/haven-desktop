/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import {
    RovingAction,
    RovingGridIndexProvider as SharedRovingGridIndexProvider,
    type RovingGridIndexProviderProps,
    RovingTabIndexProvider as SharedRovingTabIndexProvider,
    type RovingTabIndexProviderProps,
} from "@element-hq/web-shared-components";

import { checkInputableElement } from "@element-hq/web-shared-components";

import { getKeyBindingsManager } from "../KeyBindingsManager";
import { KeyBindingAction } from "./KeyboardShortcuts";

export { findNextSiblingElement, RovingTabIndexContext } from "@element-hq/web-shared-components";
export { checkInputableElement } from "@element-hq/web-shared-components";
export { RovingStateActionType } from "@element-hq/web-shared-components";
export { useRovingTabIndex } from "@element-hq/web-shared-components";
export type { IAction, IState } from "@element-hq/web-shared-components";

/**
 * Module to simplify implementing the Roving TabIndex accessibility technique
 *
 * Wrap the Widget in an RovingTabIndexContextProvider
 * and then for all buttons make use of useRovingTabIndex or RovingTabIndexWrapper.
 * The code will keep track of which tabIndex was most recently focused and expose that information as `isActive` which
 * can then be used to only set the tabIndex to 0 as expected by the roving tabindex technique.
 * When the active button gets unmounted the closest button will be chosen as expected.
 * Initially the first button to mount will be given active state.
 *
 * https://developer.mozilla.org/en-US/docs/Web/Accessibility/Keyboard-navigable_JavaScript_widgets#Technique_1_Roving_tabindex
 */

// Haven: lets H/J/K/L stand in for Left/Down/Up/Right when navigating a roving-tabindex group
// (menus, the spaces bar, settings tabs, context menu items, grids like the emoji/sticker picker,
// etc). Requires no modifiers - any modifier held means it's some other shortcut, not item
// navigation. Deliberately does NOT gate on the event target being a text input here - unlike real
// arrow keys, h/j/k/l are literal characters someone may need to type, so that check has to happen
// at each call site with access to the actual target (see getWebRovingAction below), not inside
// this target-agnostic helper.
interface KeyModifiersLike {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

export function jkArrowEquivalent(
    ev: KeyModifiersLike,
): "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | undefined {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return undefined;
    if (ev.key === "j") return "ArrowDown";
    if (ev.key === "k") return "ArrowUp";
    if (ev.key === "h") return "ArrowLeft";
    if (ev.key === "l") return "ArrowRight";
    return undefined;
}

const getWebRovingAction = (ev: React.KeyboardEvent): RovingAction | undefined => {
    switch (getKeyBindingsManager().getAccessibilityAction(ev)) {
        case KeyBindingAction.Home:
            return RovingAction.Home;
        case KeyBindingAction.End:
            return RovingAction.End;
        case KeyBindingAction.ArrowLeft:
            return RovingAction.ArrowLeft;
        case KeyBindingAction.ArrowUp:
            return RovingAction.ArrowUp;
        case KeyBindingAction.ArrowRight:
            return RovingAction.ArrowRight;
        case KeyBindingAction.ArrowDown:
            return RovingAction.ArrowDown;
        case KeyBindingAction.Tab:
            return RovingAction.Tab;
        default: {
            // Haven: never treat H/J/K/L as arrows while the target is a real text input. Most
            // roving groups already skip arrow handling entirely for text inputs, but ones that
            // opt into `handleInputFields` (ForwardDialog's room search, EmojiPicker's search)
            // deliberately keep real arrow keys working while typing - h/j/k/l have to be excluded
            // from that on their own, since unlike arrow keys they're letters someone may need to
            // type (e.g. searching for a room or emoji whose name contains one).
            if (checkInputableElement(ev.target as HTMLElement)) return undefined;
            switch (jkArrowEquivalent(ev)) {
                case "ArrowUp":
                    return RovingAction.ArrowUp;
                case "ArrowDown":
                    return RovingAction.ArrowDown;
                case "ArrowLeft":
                    return RovingAction.ArrowLeft;
                case "ArrowRight":
                    return RovingAction.ArrowRight;
                default:
                    return undefined;
            }
        }
    }
};

type IRovingTabIndexProps = Omit<RovingTabIndexProviderProps, "getAction">;
type IRovingGridIndexProps = Omit<RovingGridIndexProviderProps, "getAction">;

export const RovingTabIndexProvider: React.FC<IRovingTabIndexProps> = (props) => {
    return <SharedRovingTabIndexProvider {...props} getAction={getWebRovingAction} />;
};

export const RovingGridIndexProvider: React.FC<IRovingGridIndexProps> = (props) => {
    return <SharedRovingGridIndexProvider {...props} getAction={getWebRovingAction} />;
};

// re-export the semantic helper components for simplicity
export { RovingTabIndexWrapper } from "./roving/RovingTabIndexWrapper";
export { RovingAccessibleButton } from "./roving/RovingAccessibleButton";
