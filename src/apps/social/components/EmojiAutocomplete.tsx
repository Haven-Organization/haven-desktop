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
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import EmojiProvider from "../../../../element-web/apps/web/src/autocomplete/EmojiProvider";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

const MAX_MATCHES = 20;

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
}: Props): JSX.Element | null {
    const provider = useMemo(() => new EmojiProvider(room), [room]);
    const [completions, setCompletions] = useState<ICompletion[]>([]);
    const [selectionOffset, setSelectionOffset] = useState(0);

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
