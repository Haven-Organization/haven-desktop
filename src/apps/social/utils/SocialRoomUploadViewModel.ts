/*
 * Social Overlay — SocialRoomUploadViewModel
 *
 * Subclasses stock RoomUploadViewModel to intercept exactly-one-file selections - via the stock
 * Upload button's file picker, or a window-level drop/paste routed here through receiveFiles -
 * into Social's own attachment shelf instead of uploading immediately. Zero or 2+ files still go
 * through the real stock ContentMessages.sendContentListToRoom flow unchanged (the per-file
 * confirm dialog with "Upload"/"Upload All"), matching stock behavior exactly for that case.
 *
 * Possible because RoomUploadViewModel.tsx's constructor params and checkCanUpload() were widened
 * from private to protected (see the "haven apps-framework patch" comments there) - arrow-function
 * class fields like initiateViaInputFiles/initiateViaDataTransfer aren't real prototype methods,
 * so a subclass field of the same name fully replaces the base one rather than being callable via
 * `super.foo()` - this class's own versions below are self-contained, not "extends + calls super".
 */

import { type MatrixClient, type Room, type IEventRelation, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { RoomUploadViewModel } from "../../../../element-web/apps/web/src/viewmodels/room/RoomUploadViewModel";
import ContentMessages from "../../../../element-web/apps/web/src/ContentMessages";
import { type TimelineRenderingType } from "../../../../element-web/apps/web/src/contexts/RoomContext";
import { type MatrixDispatcher } from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { type AttachmentDropTarget } from "./activeAttachmentTarget";

export class SocialRoomUploadViewModel extends RoomUploadViewModel implements AttachmentDropTarget {
    public constructor(
        room: Room,
        client: MatrixClient,
        timelineRenderingType: TimelineRenderingType,
        dispatcher: MatrixDispatcher,
        replyToEvent: MatrixEvent | undefined,
        threadRelation: IEventRelation | undefined,
        openUploadDialog: () => void,
        private readonly onSingleFile: (file: File) => void,
    ) {
        super(room, client, timelineRenderingType, dispatcher, replyToEvent, threadRelation, openUploadDialog);
    }

    public receiveFiles = (files: File[]): void => {
        if (!this.checkCanUpload() || files.length === 0) return;

        if (files.length === 1) {
            this.onSingleFile(files[0]);
            return;
        }

        // Multiple files: the same real stock flow the plain Upload button already uses for a
        // multi-file pick - per-file "Upload"/"Upload All" confirm dialog, immediate send, no
        // shelf/staging. ContentMessages surfaces its own error dialogs on failure.
        void ContentMessages.sharedInstance().sendContentListToRoom(
            files,
            this.room.roomId,
            this.threadRelation,
            this.replyToEvent,
            this.client,
            this.timelineRenderingType,
        );
    };

    public initiateViaInputFiles = async (files: FileList | File[] | null): Promise<void> => {
        this.receiveFiles(files ? Array.from(files) : []);
    };

    public initiateViaDataTransfer = async (dataTransfer: DataTransfer): Promise<void> => {
        this.receiveFiles(dataTransfer.files ? Array.from(dataTransfer.files) : []);
    };
}
