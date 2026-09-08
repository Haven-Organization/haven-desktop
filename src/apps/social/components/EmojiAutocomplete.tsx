/*
 * Social Overlay — EmojiAutocomplete
 *
 * The same ":shortcode" completion menu (matching, ranking, and - via this fork's own
 * EmojiProvider - both real unicode emoji and MSC2545 custom pack emoji) the stock room composer
 * shows, wired directly to a plain textarea the same way SlashCommandAutocomplete.tsx already does
 * for "/" commands - see that file's own doc for why driving a provider directly off plain
 * value/selectionStart/selectionEnd is both feasible and already-established practice here, rather
 * than the full multi-provider Autocompleter or the rich EditorModel machinery real Element's own
 * BasicMessageComposer.tsx uses.
 *
 * One real difference from SlashCommandAutocomplete: CommandProvider's own regex is anchored to
 * the *start* of the string (a command can only ever be the first word), so passing the whole
 * textarea body as `query` just works. EmojiProvider's own regex is anchored to the *end* of the
 * string instead (`...:[+-\w]*:?)$` - it matches "the shortcode word immediately before wherever
 * we're asking about"), which in the rich composer is trivially true since `query` there is never
 * more than the current Part's own text. Handed the *whole* body instead, that anchor would only
 * ever match a shortcode sitting at the very end of the message - never one being typed in the
 * middle of a longer post. Slicing to `query.slice(0, selectionEnd)` before handing it to the
 * provider makes the caret position play the same role "end of string" does in the rich composer.
 *
 * Rendered via FloatingPortal (see this file's own anchor/floating split below) rather than as a
 * plain absolutely-positioned sibling of the textarea - this composer can be used inside a modal
 * (PostComposerDialog/ReplyComposerDialog), and a modal's own scrollable content area clips any
 * plain `position: absolute` descendant that extends past its bounds, cutting the dropdown off
 * instead of letting it float in front of the dialog. Portaling to the very end of `<body>` escapes
 * that clipping entirely; only the *position* is still derived from the anchor div's own place in
 * the composer, via floating-ui's `useFloating`.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { FloatingPortal, autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react";

import EmojiProvider from "../../../../element-web/apps/web/src/autocomplete/EmojiProvider";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

const MAX_MATCHES = 20;

/** Haven: dialogs (BaseDialog) use z-indexes up to --dialog-zIndex-standard (4012) - .mx_Autocomplete's
 *  own stylesheet z-index (1001) is only ever high enough for the plain in-room composer, which
 *  never sits inside a dialog. Only needed once portaled to <body> (see this file's own doc) -
 *  applied as an inline style since that always wins over the class's own z-index regardless of
 *  which one is more "specific". */
const DROPDOWN_Z_INDEX = 5000;

/** Haven: an always-mounted, zero-height marker at the exact spot `.mx_Autocomplete` used to
 *  anchor itself via plain CSS (`top: 100%` of the `position: relative` composer wrapper) - kept
 *  mounted regardless of whether there are completions so floating-ui always has a stable
 *  reference element to measure from the instant completions do appear. */
const ANCHOR_STYLE: React.CSSProperties = { position: "absolute", top: "100%", left: 0, right: 0, height: 0 };

/** Same shape as SlashCommandAutocompleteHandle - see that file's own doc. */
export interface EmojiAutocompleteHandle {
    hasCompletions: () => boolean;
    moveSelection: (delta: number) => void;
    confirmSelection: () => ICompletion | undefined;
    close: () => void;
}

interface Props {
    room: Room;
    /** The composer's whole current text, not just the part after the last `:` - sliced to the
     *  caret internally (see this file's own doc for why). */
    query: string;
    selectionStart: number;
    selectionEnd: number;
    onConfirm: (completion: ICompletion) => void;
    onCompletionsChange: (hasCompletions: boolean) => void;
    controlRef: React.RefObject<EmojiAutocompleteHandle | null>;
}

export function EmojiAutocomplete({
    room,
    query,
    selectionStart,
    selectionEnd,
    onConfirm,
    onCompletionsChange,
    controlRef,
}: Props): JSX.Element {
    const provider = useMemo(() => new EmojiProvider(room), [room]);
    const [completions, setCompletions] = useState<ICompletion[]>([]);
    const [selectionOffset, setSelectionOffset] = useState(0);

    const { refs, floatingStyles } = useFloating({
        placement: "bottom-start",
        whileElementsMounted: autoUpdate,
        middleware: [
            offset(0),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            // Haven: .mx_Autocomplete's own stylesheet sets `width: 100%` - relative to whatever
            // containing block it's actually in. That was always the narrow composer wrapper before
            // this was portaled to <body> (see this file's own doc); portaled, "100%" instead
            // resolves against the viewport/body itself, stretching the dropdown across the entire
            // window instead of just the composer. Set an explicit pixel width matching the anchor
            // (the composer's own width) directly on the floating element to override that.
            //
            // Also constrains height to whatever room `flip`/`shift` found (`availableHeight`) with
            // its own scrollbar - EmojiProvider can return up to MAX_MATCHES rows, tall enough that
            // its unconstrained content height regularly exceeds the room below the composer inside
            // a modal. Unconstrained, `flip` (above) reacts to that by moving the whole dropdown
            // above the composer instead - which just relocates the overflow to above the viewport's
            // own top edge instead of fixing it (confirmed live: typing ":s" inside the Post modal,
            // with enough matches, rendered the dropdown running off the top of the window). Scrolling
            // internally instead means the dropdown never needs more room than the caller actually has.
            size({
                padding: 8,
                apply({ rects, elements, availableHeight }) {
                    Object.assign(elements.floating.style, {
                        width: `${rects.reference.width}px`,
                        maxHeight: `${availableHeight}px`,
                        overflowY: "auto",
                    });
                },
            }),
        ],
    });

    // See this file's own doc - EmojiProvider's commandRegex is end-anchored, so it must only ever
    // see the text up to the caret, not anything typed after it.
    const queryToCaret = query.slice(0, selectionEnd);

    useEffect(() => {
        let cancelled = false;
        void provider
            .getCompletions(queryToCaret, { start: selectionStart, end: selectionEnd }, false, MAX_MATCHES)
            .then((results) => {
                if (cancelled) return;
                // EmojiProvider's own commandRegex is `(?:^|\s):[+-\w]*:?)$` - the leading `\s`
                // alternative is part of the matched range, not just a lookbehind, so a completion
                // triggered mid-message (as opposed to at the very start) has a range that starts
                // on the whitespace character right before the ":". The rich composer never notices
                // this - AutocompleteWrapperModel confirms against the current Part's own text,
                // which never includes a preceding space, a separate Part of its own. Splicing this
                // range as-is into a plain string would eat that space along with the ":shortcode:"
                // text it's replacing - bump range.start past it so it's preserved instead.
                const adjusted = results.map((c) =>
                    /\s/.test(queryToCaret[c.range.start] ?? "") ? { ...c, range: { ...c.range, start: c.range.start + 1 } } : c,
                );
                setCompletions(adjusted);
                setSelectionOffset(0);
                onCompletionsChange(adjusted.length > 0);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider, queryToCaret, selectionStart, selectionEnd]);

    const clear = (): void => {
        setCompletions([]);
        onCompletionsChange(false);
    };

    controlRef.current = {
        hasCompletions: () => completions.length > 0,
        moveSelection: (delta: number) => {
            if (completions.length === 0) return;
            setSelectionOffset((i) => (i + delta + completions.length) % completions.length);
        },
        confirmSelection: () => {
            if (completions.length === 0) return undefined;
            const completion = completions[selectionOffset];
            onConfirm(completion);
            clear();
            return completion;
        },
        close: clear,
    };

    return (
        <>
            <div ref={refs.setReference} style={ANCHOR_STYLE} />
            {completions.length > 0 && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        // Haven: .mx_Autocomplete's own stylesheet rule sets `bottom: 0` (for its
                        // original always-bottom-anchored, non-portaled usage in the plain in-room
                        // composer) - social-overlay.scss's own `bottom: auto` override for this
                        // composer only matches while this element is still a DESCENDANT of
                        // `.social_ComposeBox_inputWrap`, which portaling it to <body> breaks. Left
                        // unset, the browser satisfies both the inline `top` (from floatingStyles)
                        // and the stylesheet's own `bottom: 0` at once by stretching the element's
                        // height to span between them - confirmed live, ballooning it to nearly the
                        // full viewport height instead of sizing to its own content.
                        style={{ ...floatingStyles, zIndex: DROPDOWN_Z_INDEX, bottom: "auto" }}
                        id="mx_Autocomplete"
                        className="mx_Autocomplete"
                        role="listbox"
                    >
                        <div className="mx_Autocomplete_ProviderSection" role="presentation">
                            <div className="mx_Autocomplete_provider_name">{provider.getName()}</div>
                            {provider.renderCompletions(
                                completions.map((completion, i) =>
                                    React.cloneElement(completion.component, {
                                        key: i,
                                        className: `mx_Autocomplete_Completion${i === selectionOffset ? " selected" : ""}`,
                                        onClick: () => {
                                            onConfirm(completion);
                                            clear();
                                        },
                                        "aria-selected": i === selectionOffset,
                                    }),
                                ),
                            )}
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
