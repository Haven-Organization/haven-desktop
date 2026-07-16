/*
 * Social Overlay — PostComposerDialog
 *
 * Shared base for every "compose and send to a room" modal (RepostDialog's quote post, PostDialog's
 * plain post) — dialog chrome, textarea, room picker, and composer buttons are identical between
 * them; the only real difference is what (if anything) renders between the textarea and the footer,
 * and what sending actually does with the typed body. See RepostDialog.tsx/PostDialog.tsx for the
 * two callers.
 *
 * Modal.createDialog renders into its own separate React root (see Modal.tsx's reRender — it only
 * wraps dialog content with I18nContext/TooltipProvider, not MatrixClientContext), so
 * useMatrixClientContext() would return null in here. `client` is passed in explicitly from the
 * caller instead, and re-provided via MatrixClientContext.Provider so nested stock components that
 * DO expect context (PostComposerButtons's MessageComposerButtons chain) get a real client.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { MSC4501_EVENT_POST, isProfileRoomType, isGroupRoomType } from "../utils/room-classifier";
import { useProfileRoomLink } from "../utils/useProfileRoomLink";
import { peekPendingRoomPick, clearPendingRoomPick } from "../utils/pendingRoomPick";
import { usePendingAttachment } from "../utils/postAttachment";
import { handleComposerPaste } from "../utils/pasteFile";
import { PostComposerButtons } from "./PostComposerButtons";
import { RoomPickerButton } from "./RoomPickerButton";
import { AttachmentShelf } from "./AttachmentShelf";

interface Props {
    client: MatrixClient;
    title: string;
    placeholder: string;
    sendButtonTitle: string;
    /** Rendered between the textarea and the room-picker/composer-buttons footer — e.g.
     *  RepostPreview for a quote post. Omitted entirely for a plain post. */
    extraContent?: JSX.Element;
    /** Prefills the composer body - used by PostDialog's "#/social?post=1&body=..." deep link
     *  (see pendingPostModal.ts). Only ever read once, on mount - not a controlled value. */
    initialBody?: string;
    /** Preselects the "Post to:" room - used when this dialog is opened as the scrolled-away
     *  fallback for an inline composer (see openScrolledAwayPostModal in SocialHomeView.tsx/
     *  SocialRoomView.tsx) so the popped-up composer targets the same room the inline one would
     *  have. Only ever read once, on mount, same as initialBody - the user's own RoomPickerButton
     *  choice (explicitRoomId) always wins over this afterward. */
    initialRoomId?: string;
    /** Stages a file (e.g. one just dropped/pasted while the inline composer this dialog is
     *  standing in for was scrolled out of view) straight into this dialog's own attachment shelf
     *  on open, exactly as if the user had picked it here themselves. Only ever read once, on
     *  mount. */
    initialFile?: File;
    onSubmit: (body: string, targetRoomId: string, file?: File) => Promise<void>;
    onFinished: (sent?: boolean) => void;
}

export function PostComposerDialog({
    client,
    title,
    placeholder,
    sendButtonTitle,
    extraContent,
    initialBody,
    initialRoomId,
    initialFile,
    onSubmit,
    onFinished,
}: Props): JSX.Element {
    const myUserId = client.getUserId() ?? "";

    const postableRooms = useMemo(() => {
        return client.getRooms().filter((r) => {
            const type = r.currentState.getStateEvents("m.room.create", "")?.getContent()?.type;
            if (!isProfileRoomType(type) && !isGroupRoomType(type)) return false;
            const member = r.getMember(myUserId);
            if (member?.membership !== "join") return false;
            return r.currentState.maySendEvent(MSC4501_EVENT_POST, myUserId);
        });
    }, [client, myUserId]);

    // The profile room is always whatever room org.matrix.msc4501.social.profile_room_id names on
    // the user's own profile (see useProfileRoomLink) - no local guessing while it's still
    // resolving, since a user can genuinely have more than one room that locally looks like
    // "theirs" with no reliable way to tell which one the real link will resolve to.
    const profileRoomId = useProfileRoomLink(client, myUserId);
    const myProfileRoom = useMemo(() => {
        if (!profileRoomId) return null; // still loading (undefined) or confirmed unlinked (null)
        return postableRooms.find((r) => r.roomId === profileRoomId) ?? null;
    }, [postableRooms, profileRoomId]);

    // A derived value (not frozen state computed once at mount) so it tracks myProfileRoom as
    // profileRoomId resolves - see FeedPane's own identical explicitRoomId/selectedRoomId split in
    // SocialHomeView.tsx. explicitRoomId is only ever set by the user's own dropdown choice below;
    // until they do, this always reflects the real link once it resolves, rather than staying
    // stuck on whatever postableRooms[0] fallback happened to show at the moment this dialog first
    // opened.
    // Lazy initializer, not a plain useState(""): this component gets fully remounted with fresh
    // state every time RoomPickerButton opens/closes its own nested RoomPickerModal (see
    // pendingRoomPick.ts for why) - reading the bridge here is what makes the freshly-mounted
    // instance actually reflect the room that was just picked, since the plain onChange callback
    // below fires too late, on the already-unmounted previous instance.
    const [explicitRoomId, setExplicitRoomId] = useState(() => peekPendingRoomPick() ?? initialRoomId ?? "");

    // Only clears on this dialog's own real close (submitted or cancelled) - not on the fake
    // unmount above, since nothing has had a chance to re-set the bridge in between those two
    // cases. Prevents a later, unrelated fresh Post/Quote-post open from inheriting a stale pick.
    useEffect(() => clearPendingRoomPick, []);
    // postableRooms[0] is only a reasonable fallback once profileRoomId is *confirmed* absent
    // (null) - while it's still resolving (undefined), falling back to it too showed whatever
    // unrelated profile/group room happened to be first in postableRooms (e.g. a since-unlinked
    // old profile room, still joined) for the brief moment before the real link landed, flashing
    // its avatar/name before snapping to "Your Profile" - not just "no room selected yet".
    const targetRoomId =
        explicitRoomId || myProfileRoom?.roomId || (profileRoomId === null ? postableRooms[0]?.roomId : undefined) || "";
    const [body, setBody] = useState(initialBody ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recorderSlot, setRecorderSlot] = useState<HTMLDivElement | null>(null);
    const { attachment, setFile, clear: clearAttachment } = usePendingAttachment();

    // Stage initialFile once, on mount - same "read once, not a controlled value" contract as
    // initialBody above. setFile is stable (see usePendingAttachment), so this genuinely only
    // needs to run once regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (initialFile) setFile(initialFile);
    }, []);

    const handleSubmit = useCallback(
        async (e?: React.SyntheticEvent): Promise<void> => {
            e?.preventDefault();
            if ((!body.trim() && !attachment) || !targetRoomId) return;
            // Same guard as FeedPane's handleFeedPost in SocialHomeView.tsx: without an explicit
            // user choice, targetRoomId falls back to postableRooms[0] while the real
            // profile_room_id link is still resolving, not necessarily the user's own profile
            // room. Block sending rather than risk silently posting to the wrong room.
            if (!explicitRoomId && profileRoomId === undefined) return;
            setBusy(true);
            setError(null);
            try {
                await onSubmit(body.trim(), targetRoomId, attachment?.file);
                onFinished(true);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to post");
                setBusy(false);
            }
        },
        [body, targetRoomId, explicitRoomId, profileRoomId, attachment, onSubmit, onFinished],
    );

    const targetRoom = targetRoomId ? client.getRoom(targetRoomId) : null;

    return (
        <MatrixClientContext.Provider value={client}>
            <BaseDialog className="social_PostComposerDialog" title={title} hasCancel onFinished={() => onFinished(false)}>
                <form className="social_PostComposerDialog_form" onSubmit={handleSubmit}>
                    <textarea
                        className="social_ComposeBox_input"
                        placeholder={placeholder}
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
                        rows={3}
                        autoFocus
                    />
                    {attachment && (
                        <AttachmentShelf attachment={attachment} uploading={busy} onRemove={clearAttachment} />
                    )}
                    {extraContent}
                    {error && <p className="social_Error">{error}</p>}
                    <div className="social_ComposeBox_recorderSlot" ref={setRecorderSlot} />
                    <div className="social_PostComposerDialog_footer">
                        <div className="social_ComposeBox_roomPicker">
                            <span className="social_ComposeBox_label">Post to:</span>
                            <RoomPickerButton
                                client={client}
                                value={targetRoomId}
                                myProfileRoomId={myProfileRoom?.roomId}
                                onChange={setExplicitRoomId}
                            />
                        </div>
                        {targetRoom && !busy && (
                            <PostComposerButtons
                                room={targetRoom}
                                addEmoji={(emoji) => {
                                    setBody((b) => b + emoji);
                                    return true;
                                }}
                                canSubmit={
                                    (!!body.trim() || !!attachment) && (!!explicitRoomId || profileRoomId !== undefined)
                                }
                                onSubmit={() => void handleSubmit()}
                                sendButtonTitle={sendButtonTitle}
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
