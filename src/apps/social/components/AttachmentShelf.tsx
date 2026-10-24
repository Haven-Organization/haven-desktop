/*
 * Social Overlay — AttachmentShelf
 *
 * The staged-attachment tile shown between a composer's textbox and its button row once a file
 * has been picked/pasted/dropped, but before the post is actually sent (see
 * src/apps/social/utils/postAttachment.ts for the state this renders, and social-actions.ts's
 * buildMediaMessageContent for the deferred upload that happens on send). One tile for now - the
 * shelf only ever holds a single pending file.
 */

import React, { type JSX, useEffect, useState } from "react";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import DocumentIcon from "@vector-im/compound-design-tokens/assets/web/icons/document";
import LocationPinIcon from "@vector-im/compound-design-tokens/assets/web/icons/location-pin";
import MicOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on";

import Spinner from "../../../../element-web/apps/web/src/components/views/elements/Spinner";
import { mediaFromMxc } from "../../../../element-web/apps/web/src/customisations/Media";
import { decryptFile } from "../../../../element-web/apps/web/src/utils/DecryptFile";
import { type PendingAttachment } from "../utils/postAttachment";
import { type StagedMedia } from "../utils/postEdit";

interface Props {
    /** A newly picked file, or media the post already has (see postEdit.ts). */
    attachment: PendingAttachment | StagedMedia;
    /** True while the actual upload (kicked off by hitting Send) is in flight for this file. */
    uploading: boolean;
    onRemove: () => void;
}

/**
 * A preview image for media that's already uploaded: its thumbnail, or the image itself, decrypted
 * first in an encrypted room. Null while loading, and for anything without one.
 */
function useStagedMediaPreview(media: StagedMedia | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        setUrl(null);
        if (!media || (media.kind !== "image" && media.kind !== "video")) return;
        const content = media.content as Record<string, any>;
        const info = content.info ?? {};
        const encrypted = info.thumbnail_file ?? (media.kind === "image" ? content.file : undefined);
        if (!encrypted) {
            const mxc = info.thumbnail_url ?? (media.kind === "image" ? content.url : undefined);
            if (mxc) setUrl(mediaFromMxc(mxc).getThumbnailOfSourceHttp(192, 192, "scale"));
            return;
        }
        let objectUrl: string | null = null;
        let canceled = false;
        decryptFile(encrypted, info.thumbnail_info ?? info)
            .then((blob) => {
                if (canceled) return;
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            })
            .catch(() => {});
        return () => {
            canceled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [media]);
    return url;
}

function isStagedMedia(attachment: PendingAttachment | StagedMedia): attachment is StagedMedia {
    return "kind" in attachment;
}

export function AttachmentShelf({ attachment, uploading, onRemove }: Props): JSX.Element {
    const staged = isStagedMedia(attachment) ? attachment : null;
    const stagedPreviewUrl = useStagedMediaPreview(staged);
    const name = staged ? staged.name : (attachment as PendingAttachment).file.name;
    const previewUrl = staged ? stagedPreviewUrl : (attachment as PendingAttachment).previewUrl;
    const isVideo = staged ? false : (attachment as PendingAttachment).file.type.startsWith("video/");
    const FallbackIcon =
        staged?.kind === "location" ? LocationPinIcon : staged?.kind === "voice" ? MicOnIcon : DocumentIcon;

    return (
        <div className="social_AttachmentShelf">
            <div className="social_AttachmentShelf_tile" title={name}>
                {previewUrl ? (
                    isVideo ? (
                        <video className="social_AttachmentShelf_preview" src={previewUrl} muted playsInline />
                    ) : (
                        <img className="social_AttachmentShelf_preview" src={previewUrl} alt={name} />
                    )
                ) : (
                    <div className="social_AttachmentShelf_filePreview">
                        <FallbackIcon className="social_AttachmentShelf_fileIcon" />
                        <span className="social_AttachmentShelf_fileName" title={name}>
                            {name}
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
