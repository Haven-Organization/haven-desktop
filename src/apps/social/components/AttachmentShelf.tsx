/*
 * Social Overlay — AttachmentShelf
 *
 * The staged-attachment tile shown between a composer's textbox and its button row once a file
 * has been picked/pasted/dropped, but before the post is actually sent (see
 * src/apps/social/utils/postAttachment.ts for the state this renders, and social-actions.ts's
 * buildMediaMessageContent for the deferred upload that happens on send). One tile for now - the
 * shelf only ever holds a single pending file.
 */

import React, { type JSX } from "react";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import DocumentIcon from "@vector-im/compound-design-tokens/assets/web/icons/document";

import Spinner from "../../../../element-web/apps/web/src/components/views/elements/Spinner";
import { type PendingAttachment } from "../utils/postAttachment";

interface Props {
    attachment: PendingAttachment;
    /** True while the actual upload (kicked off by hitting Send) is in flight for this file. */
    uploading: boolean;
    onRemove: () => void;
}

export function AttachmentShelf({ attachment, uploading, onRemove }: Props): JSX.Element {
    const { file, previewUrl } = attachment;

    return (
        <div className="social_AttachmentShelf">
            <div className="social_AttachmentShelf_tile" title={file.name}>
                {previewUrl ? (
                    file.type.startsWith("video/") ? (
                        <video className="social_AttachmentShelf_preview" src={previewUrl} muted playsInline />
                    ) : (
                        <img className="social_AttachmentShelf_preview" src={previewUrl} alt={file.name} />
                    )
                ) : (
                    <div className="social_AttachmentShelf_filePreview">
                        <DocumentIcon className="social_AttachmentShelf_fileIcon" />
                        <span className="social_AttachmentShelf_fileName" title={file.name}>
                            {file.name}
                        </span>
                    </div>
                )}
                {uploading && (
                    <div className="social_AttachmentShelf_uploadingOverlay">
                        <Spinner size={24} />
                    </div>
                )}
                <button
                    type="button"
                    // mx_Dialog_nonDialogButton: stock's own escape hatch (_common.pcss) from the
                    // generic "any plain <button> inside .mx_Dialog gets Cancel/OK-style width:
                    // auto / padding: 7px 1.5em / margin-bottom: 5px" treatment - this tile's
                    // remove button rendered fine standalone (Feed/room composer are never inside
                    // a .mx_Dialog) but stretched and misaligned once rendered inside the pop-up
                    // Post/Reply modal without it, since that generic rule's own specificity beats
                    // .social_AttachmentShelf_remove's.
                    className="social_AttachmentShelf_remove mx_Dialog_nonDialogButton"
                    onClick={onRemove}
                    aria-label="Remove attachment"
                    title="Remove attachment"
                >
                    <CloseIcon width="14px" height="14px" />
                </button>
            </div>
        </div>
    );
}
