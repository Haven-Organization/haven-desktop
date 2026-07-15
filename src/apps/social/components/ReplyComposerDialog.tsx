/*
 * Social Overlay — ReplyComposerDialog
 *
 * Replaces the reply form that used to expand out inline underneath a post with a real modal
 * dialog — same darkened backdrop + bordered dialog chrome as Room Settings (both just use
 * Element's stock BaseDialog). Button row is the same PostComposerButtons everything else uses.
 * Shows the post being replied to above the compose box, Twitter-style.
 *
 * Modal.createDialog renders into its own separate React root (see Modal.tsx's reRender — it only
 * wraps dialog content with I18nContext/TooltipProvider, not MatrixClientContext). PostComposerButtons's
 * MessageComposerButtons chain expects a real client from that context and silently renders nothing
 * without one, so `client` is passed in explicitly and re-provided here.
 */

import React, { type JSX, useCallback, useState } from "react";
import { type MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { usePendingAttachment } from "../utils/postAttachment";
import { handleComposerPaste } from "../utils/pasteFile";
import { PostComposerButtons } from "./PostComposerButtons";
import { RepostPreview } from "./RepostPreview";
import { AttachmentShelf } from "./AttachmentShelf";

interface Props {
    client: MatrixClient;
    /** Display name of who's being replied to, shown in the dialog title. */
    replyingToName: string;
    room: Room;
    /** The post being replied to, shown in a preview above the compose box. */
    replyTargetEvent: MatrixEvent;
    onReply: (body: string, file?: File) => Promise<void>;
    onFinished: (sent?: boolean) => void;
}

export function ReplyComposerDialog({
    client,
    replyingToName,
    room,
    replyTargetEvent,
    onReply,
    onFinished,
}: Props): JSX.Element {
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);
    const [recorderSlot, setRecorderSlot] = useState<HTMLDivElement | null>(null);
    const { attachment, setFile, clear: clearAttachment } = usePendingAttachment();

    const handleSubmit = useCallback(
        async (e?: React.SyntheticEvent): Promise<void> => {
            e?.preventDefault();
            if (!body.trim() && !attachment) return;
            setBusy(true);
            try {
                await onReply(body.trim(), attachment?.file);
                onFinished(true);
            } finally {
                setBusy(false);
            }
        },
        [body, attachment, onReply, onFinished],
    );

    return (
        <MatrixClientContext.Provider value={client}>
            <BaseDialog
                className="social_ReplyDialog"
                title={`Reply to ${replyingToName}`}
                hasCancel
                onFinished={() => onFinished(false)}
            >
                <form className="social_ReplyDialog_form" onSubmit={handleSubmit}>
                    <RepostPreview event={replyTargetEvent} />
                    <textarea
                        className="social_ReplyDialog_input"
                        placeholder="Write a reply…"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        onPaste={handleComposerPaste}
                        onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                e.preventDefault();
                                void handleSubmit();
                            }
                        }}
                        disabled={busy}
                        rows={4}
                        autoFocus
                    />
                    {attachment && (
                        <AttachmentShelf attachment={attachment} uploading={busy} onRemove={clearAttachment} />
                    )}
                    <div className="social_ComposeBox_recorderSlot" ref={setRecorderSlot} />
                    <div className="social_ReplyDialog_actions">
                        {!busy && (
                            <PostComposerButtons
                                room={room}
                                addEmoji={(emoji) => {
                                    setBody((b) => b + emoji);
                                    return true;
                                }}
                                canSubmit={!!body.trim() || !!attachment}
                                onSubmit={() => void handleSubmit()}
                                sendButtonTitle="Reply"
                                recorderSlot={recorderSlot}
                                onFileSelected={setFile}
                            />
                        )}
                    </div>
                </form>
            </BaseDialog>
        </MatrixClientContext.Provider>
    );
}
