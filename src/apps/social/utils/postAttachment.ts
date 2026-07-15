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

export function usePendingAttachment(): {
    attachment: PendingAttachment | null;
    setFile: (file: File) => void;
    clear: () => void;
} {
    const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
    // Mirrors attachment.previewUrl across renders so it can be revoked from the unmount cleanup
    // below without that effect depending on (and re-running for) every attachment change.
    const previewUrlRef = useRef<string | null>(null);

    const setFile = useCallback((file: File) => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const previewUrl = createPreviewUrl(file);
        previewUrlRef.current = previewUrl;
        setAttachment({ file, previewUrl });
    }, []);

    const clear = useCallback(() => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setAttachment(null);
    }, []);

    useEffect(() => {
        return () => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        };
    }, []);

    return { attachment, setFile, clear };
}
