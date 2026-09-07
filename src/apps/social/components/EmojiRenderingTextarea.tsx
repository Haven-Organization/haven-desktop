/*
 * Social Overlay — EmojiRenderingTextarea
 *
 * A drop-in replacement for a plain `<textarea>` that renders any `:shortcode:` substring
 * matching a real image-pack emoji as an actual inline image, the same size/alignment
 * editor/parts.ts's own CustomEmojiPart uses in the rich room composer - instead of leaving it as
 * literal `:shortcode:` text the way every Social composer previously did even after a pick from
 * EmojiAutocomplete.tsx/the emoji picker button.
 *
 * A real `<textarea>` has no way to embed an inline image inside its own value - value is always
 * plain text. Rather than replacing it with a contenteditable rich editor (a much bigger rewrite
 * touching every composer's cursor/selection/paste handling, IME composition, etc. - all of which
 * already works correctly against a plain textarea today), this uses the standard "invisible
 * textarea + matching overlay" technique: the real `<textarea>` stays exactly as-is (still the
 * single source of truth for value/selection/paste/every existing keydown handler), just with its
 * own text painted transparent; a `pointer-events: none` overlay `<div>` sits exactly on top of it,
 * sharing the same font/padding/wrapping (via the same className), rendering the emoji-substituted
 * version of the same text. The textarea's native caret (`caret-color`) and selection highlight
 * still show through normally since only the *text glyphs* are transparent, not the element itself.
 */

import React, { type JSX, forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { buildEmoticonShortcodeMap } from "../../../../element-web/apps/web/src/utils/ImagePacks";

const SHORTCODE_RE = /(:[a-zA-Z0-9_-]+:)/g;

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> {
    /** Undefined only while a composer's own target room is still resolving (e.g. Social's Feed
     *  composer before a "post to" room is chosen) - degrades to showing shortcodes as plain text
     *  in that case, same as before this component existed, rather than requiring every caller to
     *  conditionally render a plain `<textarea>` fallback of their own. */
    room?: Room;
}

export const EmojiRenderingTextarea = forwardRef<HTMLTextAreaElement, Props>(function EmojiRenderingTextarea(
    { room, className, value, ...rest },
    forwardedRef,
) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Rebuilt only when `room` itself changes (never mid-composition) - a pack edited by someone
    // else while this composer is open won't retroactively re-render an already-typed shortcode,
    // the same "resolved once, not live-tracked" tradeoff EmojiAutocomplete.tsx's own provider
    // instance already makes for the exact same room.
    const shortcodeMap = useMemo(() => (room ? buildEmoticonShortcodeMap(room) : new Map<string, string>()), [room]);

    const text = typeof value === "string" ? value : "";
    const segments = useMemo(() => {
        return text.split(SHORTCODE_RE).map((part, i) => {
            const m = /^:([a-zA-Z0-9_-]+):$/.exec(part);
            const mxcUrl = m && shortcodeMap.get(m[1]);
            if (!mxcUrl || !room) return part;
            return (
                <img
                    key={i}
                    className="mx_EmojiRenderingTextarea_emoji"
                    src={room.client.mxcUrlToHttp(mxcUrl) ?? mxcUrl}
                    alt={part}
                    title={part}
                />
            );
        });
        // A trailing newline in a plain string collapses to nothing when rendered as the last
        // child of a block - browsers give a real <textarea> an extra bottom line for one anyway,
        // so mirror that with a zero-width space rather than let the overlay run one line short.
    }, [text, shortcodeMap, room]);

    const syncScroll = (): void => {
        if (overlayRef.current && textareaRef.current) {
            overlayRef.current.scrollTop = textareaRef.current.scrollTop;
            overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    };
    // Typing past the bottom of a size-limited textarea auto-scrolls it without necessarily
    // firing a "scroll" event the overlay's own onScroll handler below would catch (e.g. Chrome
    // adjusts scrollTop as part of the same input event, not a separate scroll event) - re-sync
    // after every render as a fallback so the overlay never visibly lags a line behind.
    useLayoutEffect(syncScroll);

    return (
        <div className="mx_EmojiRenderingTextarea">
            <div ref={overlayRef} className={`mx_EmojiRenderingTextarea_overlay ${className ?? ""}`} aria-hidden="true">
                {segments}
                {text.endsWith("\n") ? "​" : null}
            </div>
            <textarea
                {...rest}
                value={value}
                className={`mx_EmojiRenderingTextarea_input ${className ?? ""}`}
                onScroll={(e) => {
                    syncScroll();
                    rest.onScroll?.(e);
                }}
                ref={(el) => {
                    textareaRef.current = el;
                    if (typeof forwardedRef === "function") forwardedRef(el);
                    else if (forwardedRef) (forwardedRef as React.RefObject<HTMLTextAreaElement | null>).current = el;
                }}
            />
        </div>
    );
}) as (props: Props & React.RefAttributes<HTMLTextAreaElement>) => JSX.Element;
