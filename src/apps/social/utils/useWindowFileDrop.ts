/*
 * Social Overlay — useWindowFileDrop
 *
 * Window-level drag-and-drop for the whole Social app (mounted once, from SocialHomeView.tsx) -
 * routes a dropped file (or files) to whichever composer is currently "active" (the topmost
 * mounted one - see activeAttachmentTarget.ts), applying the exact same single-file-vs-multi-file
 * split the stock Upload button/paste already use (SocialRoomUploadViewModel.receiveFiles).
 * Silently ignores a drop with no active target (e.g. viewing Groups, or a profile preview with no
 * composer at all) rather than letting the browser navigate away to show the raw file, which is
 * what happens by default without preventDefault on dragover/drop.
 */

import { useEffect, useState } from "react";

import { getActiveAttachmentDropTarget } from "./activeAttachmentTarget";

function hasFiles(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes("Files");
}

/** True while a file is being dragged over the window - drive a "drop to attach" overlay off it. */
export function useWindowFileDrop(): boolean {
    // A depth counter, not a boolean flipped straight off dragenter/dragleave - those events fire
    // for every descendant element the pointer crosses, not just the outermost container, so a
    // naive boolean would flicker/hide the overlay while the pointer is still validly over the
    // drop area, just over a child element of it.
    const [dragDepth, setDragDepth] = useState(0);

    useEffect(() => {
        const onDragEnter = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragDepth((d) => d + 1);
        };
        const onDragOver = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            e.preventDefault();
        };
        const onDragLeave = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            setDragDepth((d) => Math.max(0, d - 1));
        };
        const onDrop = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragDepth(0);
            if (!e.dataTransfer) return;
            getActiveAttachmentDropTarget()?.receiveFiles(Array.from(e.dataTransfer.files));
        };

        window.addEventListener("dragenter", onDragEnter);
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragenter", onDragEnter);
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
        };
    }, []);

    return dragDepth > 0;
}
