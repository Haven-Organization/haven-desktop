/*
 * Social Overlay — LikeButton
 *
 * Same emoji icon as the composer's EmojiButton, clicking toggles a quick 👍 reaction on/off
 * (onLike decides which, based on whether this user already has one — see SocialHomeView.tsx's
 * handleLike). Always shows the current 👍 reaction count next to its icon (matching Reply's own
 * icon+count pattern) rather than relying on the separate reaction-pills row (SocialReactionsRow)
 * for that number - this button is the single place that count is meant to live, so
 * SocialReactionsRow filters 👍 out of its own pills to avoid showing it twice. Hovering opens the
 * real stock ReactionPicker (the exact popup used for "React" on messages in the normal room
 * timeline) so any emoji can be used as a reaction.
 */

import React, { type JSX, useCallback, useRef, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { ReactionIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import ContextMenu, { aboveLeftOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import ReactionPicker from "../../../../element-web/apps/web/src/components/views/emojipicker/ReactionPicker";

interface Props {
    event: MatrixEvent;
    isLiked: boolean;
    count: number;
    onLike: () => void;
    /** Called whenever any emoji reaction is sent via the hover picker (not just 👍/onLike) — see
     *  ReactionPicker's own onReact doc. */
    onReact?: () => void;
    disabled?: boolean;
}

const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 200;

export function LikeButton({ event, isLiked, count, onLike, onReact, disabled }: Props): JSX.Element {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const cancelOpen = useCallback(() => {
        if (openTimer.current) {
            clearTimeout(openTimer.current);
            openTimer.current = undefined;
        }
    }, []);

    const cancelClose = useCallback(() => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = undefined;
        }
    }, []);

    const scheduleOpen = useCallback(() => {
        cancelClose();
        cancelOpen();
        openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS);
    }, [cancelClose, cancelOpen]);

    const scheduleClose = useCallback(() => {
        cancelOpen();
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
    }, [cancelOpen, cancelClose]);

    return (
        <>
            <button
                ref={buttonRef}
                className={`social_EventTile_actionBtn social_LikeButton${isLiked ? " social_LikeButton--liked" : ""}`}
                onClick={onLike}
                onMouseEnter={scheduleOpen}
                onMouseLeave={scheduleClose}
                disabled={disabled}
                aria-label={isLiked ? "Liked, click to undo" : "Like"}
                title={isLiked ? "Liked, click to undo" : "Like"}
            >
                <ReactionIcon className="social_LikeButton_icon" />
                {count > 0 && <span>{count}</span>}
            </button>

            {open && buttonRef.current && (
                <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
                    <ContextMenu
                        {...aboveLeftOf(buttonRef.current.getBoundingClientRect())}
                        onFinished={() => setOpen(false)}
                        managed={false}
                        // Defaults to true, which renders a full-viewport invisible backdrop (for
                        // click-outside-to-close) that sat on top of the Like button itself and
                        // intercepted its clicks while this hover-opened picker was showing — the
                        // click closed the menu instead of registering as a like. Not needed here
                        // anyway: this popup already closes via mouse-leave (scheduleClose above).
                        hasBackground={false}
                    >
                        <ReactionPicker mxEvent={event} onFinished={() => setOpen(false)} onReact={onReact} />
                    </ContextMenu>
                </div>
            )}
        </>
    );
}
