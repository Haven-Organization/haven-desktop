/*
 * Social Overlay — RepostPreview
 *
 * A compact preview of the post being replied to / reposted — shown above the composer in the
 * reply dialog (Twitter-style "replying to" preview) and in a rounded box in the repost dialog.
 * Reused between both so the two dialogs look consistent.
 */

import React, { type JSX } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import MemberAvatar from "../../../../element-web/apps/web/src/components/views/avatars/MemberAvatar";
import { stripReplyFallback } from "../utils/reply-fallback";

interface Props {
    event: MatrixEvent;
    className?: string;
}

export function RepostPreview({ event, className }: Props): JSX.Element {
    const sender = event.sender?.name ?? event.getSender() ?? "";
    const body = stripReplyFallback((event.getContent<{ body?: string }>().body ?? "").trim());
    const file = event.getContent<{ file?: { name: string } }>().file;

    return (
        <div className={`social_RepostPreview${className ? ` ${className}` : ""}`}>
            <MemberAvatar member={event.sender} size="24px" />
            <div className="social_RepostPreview_content">
                <div className="social_RepostPreview_sender">{sender}</div>
                <p className="social_RepostPreview_body">
                    {body.slice(0, 280)}
                    {body.length > 280 ? "…" : ""}
                </p>
                {file && <div className="social_RepostPreview_file">📎 {file.name}</div>}
            </div>
        </div>
    );
}
