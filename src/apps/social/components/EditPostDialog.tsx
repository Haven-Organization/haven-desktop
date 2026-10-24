/*
 * Social Overlay - EditPostDialog
 *
 * Edits one of the user's own posts or replies in the pop-up post composer (PostComposerDialog),
 * opened from the post's Edit button. It opens with whatever the post would have in the composer
 * if it were about to be sent again - its text, and its media, location or voice message in the
 * shelf - and everything can be changed the same as when composing it the first time. See
 * postEdit.ts for how the edit is built and sent.
 */

import React, { type JSX, useCallback, useMemo } from "react";
import { type MatrixClient, type MatrixEvent, type Room, MatrixEvent as MatrixEventClass } from "matrix-js-sdk/src/matrix";

import { buildMediaMessageContent } from "../utils/social-actions";
import { buildEditedContent, editDraftFor, sendPostEdit, type StagedMedia } from "../utils/postEdit";
import { MSC4501_RELATES_TO_KEY, MSC4501_REL_TYPE_REPOST } from "../utils/room-classifier";
import { PostComposerDialog } from "./PostComposerDialog";
import { RepostPreview } from "./RepostPreview";

interface Props {
    client: MatrixClient;
    event: MatrixEvent;
    room: Room;
    onFinished: (sent?: boolean) => void;
}

/** The post a quote post quotes, from the copy embedded in it, for the same preview the quote
 *  post composer shows. */
function quotedPostOf(event: MatrixEvent): MatrixEvent | null {
    const relation = event.getContent()[MSC4501_RELATES_TO_KEY];
    if (relation?.rel_type !== MSC4501_REL_TYPE_REPOST || !relation.content) return null;
    return new MatrixEventClass({
        type: "m.room.message",
        event_id: relation.event_id,
        room_id: relation.room_id,
        sender: relation.sender,
        content: relation.content,
    });
}

export function EditPostDialog({ client, event, room, onFinished }: Props): JSX.Element {
    // Read once, when the editor opens - later edits from elsewhere don't reset what's typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const draft = useMemo(() => editDraftFor(client, room, event), []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const quotedPost = useMemo(() => quotedPostOf(event), []);

    const handleSubmit = useCallback(
        async (body: string, roomId: string, file?: File, media?: StagedMedia): Promise<void> => {
            const content = await buildEditedContent(client, roomId, event, { body, file, media }, (f, caption) =>
                buildMediaMessageContent(client, roomId, f, caption),
            );
            await sendPostEdit(client, event, content);
        },
        [client, event],
    );

    return (
        <PostComposerDialog
            client={client}
            title="Edit post"
            placeholder="What's on your mind?"
            sendButtonTitle="Save"
            fixedRoomId={room.roomId}
            initialBody={draft.body}
            initialMedia={draft.media}
            extraContent={quotedPost ? <RepostPreview event={quotedPost} /> : undefined}
            onSubmit={handleSubmit}
            onFinished={onFinished}
        />
    );
}
