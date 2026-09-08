/*
 * Social Overlay — SlashCommandAutocomplete
 *
 * The same completion menu (styling, matching, descriptions) the stock composer shows for slash
 * commands - reuses CommandProvider's own matching logic and TextualCompletion's own rendering
 * directly, rather than the full multi-provider Autocompleter (which also matches user/room/emoji
 * mentions - out of scope here, this is slash commands only, and Autocompleter's own provider list
 * is hardcoded, not scoped-down-able). query/selection are just the plain textarea's own
 * value/selectionStart/selectionEnd - CommandProvider's matching (and the ISelectionRange type
 * generally) never assumed a rich-text editor, just plain character offsets.
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

import CommandProvider from "../../../../element-web/apps/web/src/autocomplete/CommandProvider";
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

/** Imperative controls exposed via controlRef, for the caller's own textarea onKeyDown to drive -
 *  arrow-key navigation and Enter/Tab confirmation need to intercept the textarea's normal
 *  behaviour, which only the caller's own key handler is in a position to do. */
export interface SlashCommandAutocompleteHandle {
    hasCompletions: () => boolean;
    moveSelection: (delta: number) => void;
    /** Confirms the currently-selected completion (if any) and returns it, or undefined if there
     *  was nothing to confirm. */
    confirmSelection: () => ICompletion | undefined;
    /** Dismisses the list without confirming anything - stock Element's own Escape behavior in the
     *  real composer. */
    close: () => void;
}

interface Props {
    room: Room;
    query: string;
    selectionStart: number;
    selectionEnd: number;
    onConfirm: (completion: ICompletion) => void;
    /** Called whenever the visible completion list changes (including becoming empty), so the
     *  caller knows whether to intercept navigation/confirmation keys right now. */
    onCompletionsChange: (hasCompletions: boolean) => void;
    controlRef: React.RefObject<SlashCommandAutocompleteHandle | null>;
}

export function SlashCommandAutocomplete({
    room,
    query,
    selectionStart,
    selectionEnd,
    onConfirm,
    onCompletionsChange,
    controlRef,
}: Props): JSX.Element {
    const provider = useMemo(() => new CommandProvider(room), [room]);
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
            // its own scrollbar - see EmojiAutocomplete.tsx's own copy of this comment for why:
            // unconstrained, a long completion list's content height regularly exceeds the room
            // below the composer inside a modal, and `flip` (above) reacting to that by moving the
            // whole dropdown above the composer just relocates the overflow to above the viewport's
            // own top edge instead of fixing it.
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

    useEffect(() => {
        let cancelled = false;
        void provider
            .getCompletions(query, { start: selectionStart, end: selectionEnd }, false, MAX_MATCHES)
            .then((results) => {
                if (cancelled) return;
                setCompletions(results);
                setSelectionOffset(0);
                onCompletionsChange(results.length > 0);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider, query, selectionStart, selectionEnd]);

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
