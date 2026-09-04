/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type HTMLAttributes, type JSX } from "react";
import classNames from "classnames";

import { type ViewModel, useViewModel } from "../../../../../core/viewmodel";
import { ReactionsRowButtonTooltipView, type ReactionsRowButtonTooltipViewModel } from "../ReactionsRowButtonTooltip";
import styles from "./ReactionsRowButton.module.css";

export interface ReactionsRowButtonViewSnapshot extends Pick<
    HTMLAttributes<HTMLButtonElement>,
    "className" | "aria-label"
> {
    /**
     * The reaction content to display when not using a custom image.
     */
    content?: string;
    /**
     * The total number of reactions for this content.
     */
    count: number;
    /**
     * Whether the reaction button is selected by the current user.
     */
    isSelected: boolean;
    /**
     * Whether the reaction button is disabled.
     * @default false
     */
    isDisabled?: boolean;
    /**
     * The image URL to render when using a custom reaction image.
     */
    imageSrc?: string;
    /**
     * The alt text for the custom reaction image.
     */
    imageAlt?: string;
    /**
     * Haven: whether `content` is a genuine unicode emoji (as opposed to a custom pack image or
     * freeform text) - rendered slightly bigger, closer in visual weight to a custom image
     * reaction, which otherwise looked noticeably larger by comparison. See
     * ReactionsRowButton.module.css's own doc on `.reactionsRowButtonContentEmoji`.
     */
    isEmoji?: boolean;
    /**
     * View model for the tooltip wrapper.
     */
    tooltipVm: ReactionsRowButtonTooltipViewModel;
}

export interface ReactionsRowButtonViewActions {
    /**
     * Called when the user activates the reaction button.
     */
    onClick: () => void;
    /**
     * Haven: called when the user right-clicks (context-menus) the reaction button - opens the
     * Reactions dialog (see ReactionsDialog.tsx) with this button's own reaction pre-selected.
     * Optional since not every ReactionsRowButtonViewModel implementation needs to support it.
     */
    onContextMenu?: () => void;
}

export type ReactionsRowButtonViewModel = ViewModel<ReactionsRowButtonViewSnapshot> & ReactionsRowButtonViewActions;

interface ReactionsRowButtonViewProps {
    /**
     * The view model for the reactions row button.
     */
    vm: ReactionsRowButtonViewModel;
}

/**
 * Renders a single reaction button within a reactions row.
 *
 * The button supports text or image reactions, selected and disabled
 * styling, and wraps its content in the reactions tooltip view.
 */
export function ReactionsRowButtonView({ vm }: Readonly<ReactionsRowButtonViewProps>): JSX.Element {
    const snapshot = useViewModel(vm) as ReactionsRowButtonViewSnapshot & { ariaLabel?: string };
    const { content, count, className, isSelected, isDisabled, imageSrc, imageAlt, isEmoji, tooltipVm } = snapshot;
    const ariaLabel = snapshot["aria-label"] ?? snapshot.ariaLabel;
    const ariaDisabled = isDisabled ? true : undefined;
    const onContextMenu = vm.onContextMenu;
    const handleContextMenu = onContextMenu
        ? (event: React.MouseEvent<HTMLButtonElement>): void => {
              event.preventDefault();
              onContextMenu();
          }
        : undefined;
    const classes = classNames(className, styles.reactionsRowButton, {
        [styles.reactionsRowButtonSelected]: isSelected,
        [styles.reactionsRowButtonDisabled]: isDisabled,
    });

    const reactionContent = imageSrc ? (
        // Haven: 22px, up from 16px - see ReactionsRowButton.module.css's own doc on the pill's
        // overall size bump (line-height now 24px); a custom pack emoji's image was barely visible
        // at the old size, noticeably smaller than the pill containing it.
        <img className={styles.reactionsRowButtonContent} alt={imageAlt ?? ""} src={imageSrc} width="22" height="22" />
    ) : (
        <span
            className={classNames(styles.reactionsRowButtonContent, {
                [styles.reactionsRowButtonContentEmoji]: isEmoji,
            })}
            aria-hidden="true"
        >
            {content ?? ""}
        </span>
    );

    return (
        // Haven: onContextMenu lives on this wrapper, not the <button> itself - Tooltip's own
        // trigger-cloning (via Floating UI's getReferenceProps) only forwards a fixed set of known
        // interaction handlers (onClick among them) and silently drops unrecognised ones like
        // onContextMenu when it clones the button. contextmenu bubbles, so listening here instead
        // still fires correctly on a right-click anywhere on the button.
        <span onContextMenu={handleContextMenu}>
            <ReactionsRowButtonTooltipView vm={tooltipVm}>
                <button
                    type="button"
                    className={classes}
                    tabIndex={0}
                    aria-label={ariaLabel}
                    aria-disabled={ariaDisabled}
                    onClick={isDisabled ? undefined : vm.onClick}
                >
                    {reactionContent}
                    <span className={styles.reactionsRowButtonCount} aria-hidden="true">
                        {count}
                    </span>
                </button>
            </ReactionsRowButtonTooltipView>
        </span>
    );
}
