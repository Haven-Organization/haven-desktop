/*
 * Social Overlay — postAttachment
 *
 * Local "attachment shelf" state for a single composer - holds at most one picked/pasted/dropped
 * file until the whole post (caption + attachment) is actually sent as one call (see
 * social-actions.ts's buildMediaMessageContent for the deferred-upload step this feeds into).
 * Picking a new file while one is already staged replaces it - the shelf only ever holds one file
 * for now; a future m.gallery multi-file shelf would generalize this same hook rather than replace
 * it, per the one-attachment-for-now design.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { peekComposerDraftFile, setComposerDraftFile } from "./composerDrafts";

export interface PendingAttachment {
    file: File;
    /** Object URL for an image/video preview - null for anything else (the shelf tile falls back
     *  to a file icon + filename in that case). Revoked automatically when replaced/cleared. */
    previewUrl: string | null;
}

function createPreviewUrl(file: File): string | null {
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        return URL.createObjectURL(file);
    }
    return null;
}

/**
 * `draftKey` (see composerDrafts.ts) keeps the staged file for the session under that key: it's
 * restored when a composer with the same key mounts again, and forgotten on clear() - which is what
 * posting calls. Without it the staged file lives only as long as this component, same as before.
 */
export function usePendingAttachment(draftKey?: string): {
    attachment: PendingAttachment | null;
    setFile: (file: File) => void;
    clear: () => void;
} {
    const [attachment, setAttachment] = useState<PendingAttachment | null>(() => {
        const file = draftKey ? peekComposerDraftFile(draftKey) : null;
        return file ? { file, previewUrl: createPreviewUrl(file) } : null;
    });
    // Mirrors attachment.previewUrl across renders so it can be revoked from the unmount cleanup
    // below without that effect depending on (and re-running for) every attachment change.
    const previewUrlRef = useRef<string | null>(attachment?.previewUrl ?? null);

    const setFile = useCallback(
        (file: File) => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            const previewUrl = createPreviewUrl(file);
            previewUrlRef.current = previewUrl;
            setAttachment({ file, previewUrl });
            if (draftKey) setComposerDraftFile(draftKey, file);
        },
        [draftKey],
    );

    const clear = useCallback(() => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setAttachment(null);
        if (draftKey) setComposerDraftFile(draftKey, null);
    }, [draftKey]);

    useEffect(() => {
        return () => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        };
    }, []);

    return { attachment, setFile, clear };
}
