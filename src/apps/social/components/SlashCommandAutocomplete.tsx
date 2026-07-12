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
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import CommandProvider from "../../../../element-web/apps/web/src/autocomplete/CommandProvider";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

const MAX_MATCHES = 20;

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
}: Props): JSX.Element | null {
    const provider = useMemo(() => new CommandProvider(room), [room]);
    const [completions, setCompletions] = useState<ICompletion[]>([]);
    const [selectionOffset, setSelectionOffset] = useState(0);

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

    if (completions.length === 0) return null;

    return (
        <div id="mx_Autocomplete" className="mx_Autocomplete" role="listbox">
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
    );
}
