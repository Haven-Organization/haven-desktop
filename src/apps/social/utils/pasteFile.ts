/*
 * Social Overlay — pasteFile
 *
 * Detects a file paste in a composer's textarea, using the same rule stock Element's own
 * SendMessageComposer.onPaste applies (see element-web/apps/web/src/components/views/rooms/
 * SendMessageComposer.tsx): if the clipboard carries real files AND doesn't also carry `text/rtf`,
 * treat it as a file paste rather than plain text. The `text/rtf` exclusion specifically covers
 * pasting rich text from apps like Office on macOS, which puts a bitmap image on the clipboard
 * alongside the actual text being copied - without it, copying a paragraph of formatted text would
 * wrongly attach that incidental bitmap instead of pasting the text.
 *
 * Deliberately doesn't replicate stock's further Safari-specific `text/html` "Insert from iPhone or
 * iPad" fallback (a `<img src="blob:...">` fetched back into a File) - a narrow, single-browser
 * path not worth the added complexity here; a plain image/file paste (the common case on every
 * platform) is fully covered.
 */

import { type ClipboardEvent } from "react";

import { getActiveAttachmentDropTarget } from "./activeAttachmentTarget";

export function extractPastedFiles(dataTransfer: DataTransfer): File[] {
    if (dataTransfer.files.length === 0 || dataTransfer.types.includes("text/rtf")) {
        return [];
    }
    return Array.from(dataTransfer.files);
}

/**
 * Shared onPaste handler for every composer textarea - a paste happening while a given composer's
 * textarea has focus means that composer's own SocialRoomUploadViewModel is the current
 * window-level drop target too (see activeAttachmentTarget.ts), so routing through the same
 * receiveFiles entry point the Upload button and window-drop already use gets the identical
 * single-file-to-shelf / multiple-files-to-stock-dialog split for free, with nothing composer-
 * specific to wire up here.
 */
export function handleComposerPaste(e: ClipboardEvent): void {
    const files = extractPastedFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    getActiveAttachmentDropTarget()?.receiveFiles(files);
}
