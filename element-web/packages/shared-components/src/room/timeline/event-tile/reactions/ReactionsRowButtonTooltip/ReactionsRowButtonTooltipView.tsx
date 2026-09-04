/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type PropsWithChildren, type JSX, cloneElement, isValidElement, useRef, useState } from "react";
import React from "react";
import {
    FloatingArrow,
    FloatingPortal,
    arrow,
    autoUpdate,
    flip,
    offset,
    safePolygon,
    shift,
    useDismiss,
    useFloating,
    useFocus,
    useHover,
    useInteractions,
    useMergeRefs,
} from "@floating-ui/react";

import { type ViewModel, useViewModel } from "../../../../../core/viewmodel";
import styles from "./ReactionsRowButtonTooltip.module.css";

/**
 * Snapshot interface for the ReactionsRowButtonTooltip view.
 */
export interface ReactionsRowButtonTooltipViewSnapshot {
    /**
     * The formatted list of sender names who reacted.
     */
    formattedSenders?: string;
    /**
     * The caption to display (e.g., the shortcode of the reaction).
     */
    caption?: string;
    /**
     * Whether the tooltip should be forced open.
     */
    tooltipOpen?: boolean;
    /**
     * The reaction key itself (a unicode emoji, or a custom `mxc://` reaction). Shown large only
     * when `hasEmojiIcon` is true - otherwise it's a freeform-text reaction, already reflected in
     * `caption` instead, and no icon is rendered for it at all.
     */
    content?: string;
    /**
     * Whether `content` (or `imageSrc`) is a real emoji/pack image worth rendering as a big icon.
     * False for a freeform-text reaction (e.g. "LOST"), which has no sensible icon-sized rendering.
     */
    hasEmojiIcon?: boolean;
    /**
     * A custom reaction image to show instead of `content`, when the reaction is a pack emoji.
     */
    imageSrc?: string;
    imageAlt?: string;
    /**
     * Called when the popover is clicked - opens ReactionsDialog with this reaction pre-selected.
     */
    onOpenDialog?: () => void;
}

export type ReactionsRowButtonTooltipViewModel = ViewModel<ReactionsRowButtonTooltipViewSnapshot>;

interface ReactionsRowButtonTooltipViewProps {
    /**
     * The view model for the reactions row button tooltip.
     */
    vm: ReactionsRowButtonTooltipViewModel;
    /**
     * The children to wrap with the tooltip.
     */
    children?: PropsWithChildren["children"];
}

/**
 * A rich hover popover listing who reacted with a given emoji, styled like a Compound tooltip but
 * built from raw floating-ui primitives rather than Compound's own `<Tooltip>`. That component is
 * a strict ARIA `role="tooltip"` and explicitly can't host interactive content - this one has to,
 * since clicking anywhere on it opens ReactionsDialog with this reaction selected, which also
 * means it has to stay open while the pointer travels from the trigger onto the popover itself
 * (handled below via floating-ui's `safePolygon`), not just while hovering the trigger.
 */
export function ReactionsRowButtonTooltipView({
    vm,
    children,
}: Readonly<ReactionsRowButtonTooltipViewProps>): JSX.Element {
    const { formattedSenders, caption, tooltipOpen, content, hasEmojiIcon, imageSrc, imageAlt, onOpenDialog } =
        useViewModel(vm);
    const arrowRef = useRef(null);

    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = tooltipOpen ?? uncontrolledOpen;

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setUncontrolledOpen,
        placement: "top",
        whileElementsMounted: autoUpdate,
        middleware: [offset(8), flip({ padding: 5 }), shift({ padding: 5 }), arrow({ element: arrowRef })],
    });

    const hover = useHover(context, { move: false, handleClose: safePolygon() });
    const focus = useFocus(context);
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);

    const childRef = isValidElement(children) ? (children as { ref?: React.Ref<Element> }).ref : undefined;
    const referenceRef = useMergeRefs([refs.setReference, childRef ?? null]);

    if (!formattedSenders || !isValidElement(children)) {
        return <>{children}</>;
    }

    const trigger = cloneElement(
        children,
        getReferenceProps({ ...(typeof children.props === "object" ? children.props : {}), ref: referenceRef }),
    );

    const handleOpenDialog = (): void => {
        setUncontrolledOpen(false);
        onOpenDialog?.();
    };

    return (
        <>
            {trigger}
            {context.open && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        role="button"
                        tabIndex={0}
                        className={styles.popover}
                        {...getFloatingProps({
                            // Haven: passed as userProps rather than spread after getFloatingProps()
                            // - useInteractions() merges handlers passed this way with its own
                            // (e.g. useDismiss's own Escape-key onKeyDown) instead of one silently
                            // clobbering the other, which a later plain spread would do.
                            onClick: handleOpenDialog,
                            onKeyDown: (ev): void => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                    ev.preventDefault();
                                    handleOpenDialog();
                                }
                            },
                        })}
                    >
                        <FloatingArrow
                            ref={arrowRef}
                            context={context}
                            width={12}
                            height={6}
                            className={styles.arrow}
                        />
                        {hasEmojiIcon && (
                            <div className={styles.icon}>
                                {imageSrc ? (
                                    <img src={imageSrc} alt={imageAlt} className={styles.iconImage} />
                                ) : (
                                    content
                                )}
                            </div>
                        )}
                        <div className={styles.body}>
                            <div className={styles.senders}>{formattedSenders}</div>
                            {caption && <div className={styles.caption}>{caption}</div>}
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
