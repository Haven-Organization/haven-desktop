/*
 * Social Overlay — PostComposerButtons
 *
 * The exact stock composer button row (Emoji / Upload / "…" menu with Sticker, Voice Message,
 * Poll, Location) reused as-is for posts — these are real Matrix events regardless of which
 * timeline they land in, so the same components Element already has for sending them work
 * unchanged; nothing here reimplements upload, recording, sticker-picking, poll creation or
 * location sharing, it just wires the same pieces stock MessageComposer wires:
 *
 * - `MessageComposerButtons` needs `room`/`narrow` from ScopedRoomContext (its own `useRoomCall`
 *   dependency-free — that fragile hook belongs to RoomHeader, not this component) — supplied by
 *   a `ScopedRoomContextProvider` built here with the same sensible defaults RoomContext.ts's own
 *   default context value uses (this component doesn't render inside a real RoomView, so there's
 *   no Provider already in the tree).
 * - Its Upload button needs a `RoomUploadContextProvider` ancestor (throws without one) — provided
 *   here too.
 * - Voice Message needs `VoiceRecordComposerTile` + `VoiceRecordingStore`, both fully self-
 *   contained (take `room` as a plain prop, no context needed) — rendered/wired exactly the way
 *   MessageComposer.tsx does: a ref for imperative start/stop/send, `VoiceRecordingStore`'s
 *   UPDATE_EVENT to track whether a recording is in progress so other buttons disable themselves.
 * - Sticker uses stock `Stickerpicker` directly (also has no context dependency).
 */

import React, { type JSX, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Room, type IEventRelation } from "matrix-js-sdk/src/matrix";

import { ScopedRoomContextProvider } from "../../../../element-web/apps/web/src/contexts/ScopedRoomContext";
import { RoomUploadContextProvider } from "../../../../element-web/apps/web/src/viewmodels/room/RoomUploadViewModel";
import MessageComposerButtons from "../../../../element-web/apps/web/src/components/views/rooms/MessageComposerButtons";
import Stickerpicker from "../../../../element-web/apps/web/src/components/views/rooms/Stickerpicker";
import VoiceRecordComposerTile from "../../../../element-web/apps/web/src/components/views/rooms/VoiceRecordComposerTile";
import { VoiceRecordingStore } from "../../../../element-web/apps/web/src/stores/VoiceRecordingStore";
import { UPDATE_EVENT } from "../../../../element-web/apps/web/src/stores/AsyncStore";
import { TimelineRenderingType, MainSplitContentType } from "../../../../element-web/apps/web/src/contexts/RoomContext";
import { Layout } from "../../../../element-web/apps/web/src/settings/enums/Layout";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { isLocalRoom } from "../../../../element-web/apps/web/src/utils/localRoom/isLocalRoom";
import { aboveLeftOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import { SendButton } from "../../../../element-web/apps/web/src/components/views/rooms/MessageComposer";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { UIFeature } from "../../../../element-web/apps/web/src/settings/UIFeature";

interface Props {
    room: Room;
    relation?: IEventRelation;
    addEmoji: (emoji: string) => boolean;
    /** Whether there's text/attachment content ready to send via the caller's own (non-voice) path. */
    canSubmit: boolean;
    /** Sends whatever text/attachment content the caller is managing itself. Not called for voice. */
    onSubmit: () => void;
    sendButtonTitle?: string;
    /** DOM node (typically between the textbox and the button row) the voice recorder's own UI
     *  is portaled into, so it gets its own dedicated space instead of squeezing into the button
     *  row. Falls back to rendering inline here if not given. */
    recorderSlot?: HTMLElement | null;
}

export function PostComposerButtons({
    room,
    relation,
    addEmoji,
    canSubmit,
    onSubmit,
    sendButtonTitle,
    recorderSlot,
}: Props): JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const voiceRef = useRef<VoiceRecordComposerTile>(null);
    const [isMenuOpen, setMenuOpen] = useState(false);
    const [isStickerPickerOpen, setStickerPickerOpen] = useState(false);
    const [haveRecording, setHaveRecording] = useState(false);
    const showStickersButton = useSettingValue("MessageComposerInput.showStickersButton") && !isLocalRoom(room);
    const showPollsButton = useSettingValue("MessageComposerInput.showPollsButton");
    const showLocationButton = !(window as any).electron && SettingsStore.getValue(UIFeature.LocationSharing);

    useEffect(() => {
        const voiceRecordingId = VoiceRecordingStore.getVoiceRecordingId(room, relation);
        const update = (): void => {
            const rec = VoiceRecordingStore.instance.getActiveRecording(voiceRecordingId);
            setHaveRecording(!!rec);
        };
        update();
        VoiceRecordingStore.instance.on(UPDATE_EVENT, update);
        return () => {
            VoiceRecordingStore.instance.off(UPDATE_EVENT, update);
        };
    }, [room, relation]);

    const threadId = relation?.rel_type === "m.thread" ? relation.event_id : null;
    const menuPosition = rootRef.current ? aboveLeftOf(rootRef.current.getBoundingClientRect()) : undefined;

    const handleSend = (): void => {
        if (haveRecording) {
            void voiceRef.current?.send();
        } else {
            onSubmit();
        }
    };

    const showSendButton = canSubmit || haveRecording;

    return (
        <div className="social_PostComposerButtons" ref={rootRef}>
            <ScopedRoomContextProvider
                room={room}
                roomId={room.roomId}
                roomLoading={false}
                peekLoading={false}
                shouldPeek={false}
                membersLoaded
                numUnreadMessages={0}
                canPeek={false}
                canSelfRedact={false}
                showApps={false}
                isPeeking={false}
                showRightPanel={false}
                joining={false}
                showTopUnreadMessagesBar={false}
                statusBarVisible={false}
                canReact={false}
                canSendMessages
                resizing={false}
                layout={Layout.Group}
                lowBandwidth={false}
                alwaysShowTimestamps={false}
                showTwelveHourTimestamps={false}
                userTimezone={undefined}
                readMarkerInViewThresholdMs={3000}
                readMarkerOutOfViewThresholdMs={30000}
                showHiddenEvents={false}
                showReadReceipts
                showRedactions
                showJoinLeaves
                showAvatarChanges
                showDisplaynameChanges
                matrixClientIsReady
                showUrlPreview={false}
                timelineRenderingType={TimelineRenderingType.Room}
                mainSplitContentType={MainSplitContentType.Timeline}
                liveTimeline={undefined}
                narrow={false}
                msc3946ProcessDynamicPredecessor={false}
                canAskToJoin={false}
                promptAskToJoin={false}
                viewRoomOpts={{ buttons: [] }}
                isRoomEncrypted={null}
                roomViewStore={undefined as any}
            >
                <RoomUploadContextProvider threadRelation={relation}>
                    {recorderSlot ? (
                        createPortal(<VoiceRecordComposerTile ref={voiceRef} room={room} relation={relation} />, recorderSlot)
                    ) : (
                        <VoiceRecordComposerTile ref={voiceRef} room={room} relation={relation} />
                    )}
                    <Stickerpicker
                        room={room}
                        threadId={threadId}
                        isStickerPickerOpen={isStickerPickerOpen}
                        setStickerPickerOpen={setStickerPickerOpen}
                        menuPosition={menuPosition}
                    />
                    <MessageComposerButtons
                        addEmoji={addEmoji}
                        haveRecording={haveRecording}
                        isMenuOpen={isMenuOpen}
                        isStickerPickerOpen={isStickerPickerOpen}
                        menuPosition={menuPosition}
                        relation={relation}
                        onRecordStartEndClick={() => void voiceRef.current?.onRecordStartEndClick()}
                        setStickerPickerOpen={setStickerPickerOpen}
                        showLocationButton={showLocationButton}
                        showPollsButton={showPollsButton}
                        showStickersButton={showStickersButton}
                        isRichTextEnabled={false}
                        onComposerModeClick={() => {}}
                        toggleButtonMenu={() => setMenuOpen((v) => !v)}
                    />
                </RoomUploadContextProvider>
            </ScopedRoomContextProvider>
            {showSendButton && (
                <SendButton
                    onClick={handleSend}
                    title={haveRecording ? "Send voice message" : sendButtonTitle}
                />
            )}
        </div>
    );
}
