/*
 * Social Overlay — activeAttachmentTarget
 *
 * Tracks which mounted composer should receive a window-level file drop/paste (see
 * SocialHomeView.tsx's own drag-and-drop listener) - a mount-order stack, not a single ref, since
 * a modal composer (Post/Quote/Reply, via Modal.createDialog) mounts on top of whichever inline
 * composer (Feed/Room) is already showing underneath it. The topmost (most-recently-registered)
 * entry is always the one visually "current" from the user's own perspective, matching how a
 * modal's own darkened backdrop already makes everything behind it non-interactive - registering
 * on mount and unregistering on unmount (see PostComposerButtons.tsx) means this falls back to the
 * inline composer automatically the moment a modal closes, with no explicit hand-off needed.
 */

export interface AttachmentDropTarget {
    /** Routes dropped/pasted file(s) exactly like the stock Upload button would for the same
     *  files - a single file goes to this composer's own attachment shelf, multiple files go
     *  through the real stock upload-confirm flow instead (see SocialRoomUploadViewModel). */
    receiveFiles: (files: File[]) => void;
}

const stack: AttachmentDropTarget[] = [];

/** Call on mount; call the returned function on unmount. */
export function registerAttachmentDropTarget(target: AttachmentDropTarget): () => void {
    stack.push(target);
    return () => {
        const i = stack.indexOf(target);
        if (i !== -1) stack.splice(i, 1);
    };
}

export function getActiveAttachmentDropTarget(): AttachmentDropTarget | null {
    return stack.length > 0 ? stack[stack.length - 1] : null;
}
