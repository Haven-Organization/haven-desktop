/*
 * Social Overlay - composerDrafts
 *
 * Keeps the text typed into an inline post composer (the Feed's own, or a profile/group page's)
 * for the rest of the session, keyed by which page it belongs to. Needed because those composers
 * held their text in plain component state, and the whole Social view tree unmounts the moment the
 * user switches to anything outside Social (see lastSocialViewState.ts) - going to a room to copy
 * a picture and coming back found the half-written post gone.
 *
 * Also keeps the file staged on the composer's upload shelf (see usePendingAttachment's draftKey),
 * under the same key - the same round trip lost a pasted image even once the text survived.
 *
 * In memory only: a draft is deliberately not kept across a reload, and posting clears it (the
 * composer sets its text back to "" and clears its attachment on send, which removes both).
 */

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

const drafts = new Map<string, string>();

/** The Feed's own composer. */
export const FEED_COMPOSER_DRAFT_KEY = "feed";

/** A profile/group page's own composer. */
export function roomComposerDraftKey(roomId: string): string {
    return `room:${roomId}`;
}

const draftFiles = new Map<string, File>();

export function peekComposerDraftFile(key: string): File | null {
    return draftFiles.get(key) ?? null;
}

export function setComposerDraftFile(key: string, file: File | null): void {
    if (file) draftFiles.set(key, file);
    else draftFiles.delete(key);
}

export function peekComposerDraft(key: string): string {
    return drafts.get(key) ?? "";
}

export function setComposerDraft(key: string, body: string): void {
    if (body) drafts.set(key, body);
    else drafts.delete(key);
}

/**
 * Drop-in replacement for `useState("")` for a composer's text: starts from whatever was last
 * typed under `key` this session, and records every change under it.
 */
export function useComposerDraft(key: string): [string, Dispatch<SetStateAction<string>>] {
    const [body, setBodyState] = useState(() => peekComposerDraft(key));
    const setBody = useCallback<Dispatch<SetStateAction<string>>>(
        (value) => {
            setBodyState((prev) => {
                const next = typeof value === "function" ? value(prev) : value;
                setComposerDraft(key, next);
                return next;
            });
        },
        [key],
    );
    return [body, setBody];
}
