/*
 * Social Overlay — RepostDialog
 *
 * Quote-post modal: PostComposerDialog (shared dialog chrome/textarea/room-picker/composer
 * buttons — see there) plus the quoted post rendered via RepostPreview, and sending builds an
 * embedded m.social.repost_of block instead of a plain post.
 */

import React, { type JSX, useCallback } from "react";
import { type MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { sendRepost, type RepostContent } from "../utils/social-actions";
import { PostComposerDialog } from "./PostComposerDialog";
import { RepostPreview } from "./RepostPreview";

interface Props {
    client: MatrixClient;
    repostedEvent: MatrixEvent;
    repostedRoom: Room;
    onFinished: (sent?: boolean) => void;
}

export function RepostDialog({ client, repostedEvent, repostedRoom, onFinished }: Props): JSX.Element {
    const handleSubmit = useCallback(
        async (body: string, targetRoomId: string): Promise<void> => {
            const displayname = repostedEvent.sender?.name;
            const reposted: RepostContent = {
                event_id: repostedEvent.getId() ?? "",
                room_id: repostedRoom.roomId,
                sender: repostedEvent.getSender() ?? "",
                ...(displayname ? { displayname } : {}),
                content: repostedEvent.getContent(),
            };
            await sendRepost(client, targetRoomId, body, reposted);
        },
        [client, repostedEvent, repostedRoom],
    );

    return (
        <PostComposerDialog
            client={client}
            title="Quote post"
            placeholder="Add your comment…"
            sendButtonTitle="Quote Post"
            extraContent={<RepostPreview event={repostedEvent} />}
            onSubmit={handleSubmit}
            onFinished={onFinished}
        />
    );
}
