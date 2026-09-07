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

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { type MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { usePendingAttachment } from "../utils/postAttachment";
import { handleComposerPaste } from "../utils/pasteFile";
import { PostComposerButtons } from "./PostComposerButtons";
import { RepostPreview } from "./RepostPreview";
import { AttachmentShelf } from "./AttachmentShelf";
import { EmojiAutocomplete, type EmojiAutocompleteHandle } from "./EmojiAutocomplete";
import { EmojiRenderingTextarea } from "./EmojiRenderingTextarea";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

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

    // ":" emoji autocomplete (see EmojiAutocomplete.tsx and SocialRoomView.tsx's identical use) -
    // selection tracks the textarea's own cursor position, kept in sync via onChange/onSelect/
    // onClick/onKeyUp since a plain textarea has no dedicated "selection changed" event of its own.
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const emojiAutocompleteControlRef = useRef<EmojiAutocompleteHandle | null>(null);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const pendingCursorPos = useRef<number | null>(null);
    useEffect(() => {
        if (pendingCursorPos.current !== null && textareaRef.current) {
            textareaRef.current.selectionStart = pendingCursorPos.current;
            textareaRef.current.selectionEnd = pendingCursorPos.current;
            pendingCursorPos.current = null;
        }
    }, [body]);
    const updateSelectionFrom = useCallback((el: HTMLTextAreaElement) => {
        setSelection({ start: el.selectionStart, end: el.selectionEnd });
    }, []);
    const handleConfirmCompletion = useCallback((completion: ICompletion) => {
        const { start, end } = completion.range;
        pendingCursorPos.current = start + completion.completion.length;
        setBody((b) => b.slice(0, start) + completion.completion + b.slice(end));
    }, []);

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
                    <div className="social_ComposeBox_inputWrap">
                        <EmojiAutocomplete
                            room={room}
                            query={body}
                            selectionStart={selection.start}
                            selectionEnd={selection.end}
                            onConfirm={handleConfirmCompletion}
                            onCompletionsChange={() => {}}
                            controlRef={emojiAutocompleteControlRef}
                        />
                        <EmojiRenderingTextarea
                            room={room}
                            ref={textareaRef}
                            className="social_ReplyDialog_input"
                            placeholder="Write a reply…"
                            value={body}
                            onChange={(e) => {
                                setBody(e.target.value);
                                updateSelectionFrom(e.target);
                            }}
                            onSelect={(e) => updateSelectionFrom(e.currentTarget)}
                            onClick={(e) => updateSelectionFrom(e.currentTarget)}
                            onKeyUp={(e) => updateSelectionFrom(e.currentTarget)}
                            onPaste={handleComposerPaste}
                            onKeyDown={(e) => {
                                if (emojiAutocompleteControlRef.current?.hasCompletions()) {
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        emojiAutocompleteControlRef.current.moveSelection(-1);
                                        return;
                                    }
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        emojiAutocompleteControlRef.current.moveSelection(1);
                                        return;
                                    }
                                    if (e.key === "Enter" || e.key === "Tab") {
                                        if (emojiAutocompleteControlRef.current.confirmSelection()) {
                                            e.preventDefault();
                                            return;
                                        }
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        emojiAutocompleteControlRef.current.close();
                                        return;
                                    }
                                }
                                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    void handleSubmit();
                                }
                            }}
                            disabled={busy}
                            rows={4}
                            autoFocus
                        />
                    </div>
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
