/*
 * Social Overlay — PostDialog
 *
 * Plain post modal, opened from the Post button in Social's sidebar (see SocialHomeView.tsx).
 * PostComposerDialog (shared dialog chrome/textarea/room-picker/composer buttons — see there) with
 * no extra content between the textarea and the footer, since there's no quoted post to show.
 */

import React, { type JSX, useCallback } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { sendPost } from "../utils/social-actions";
import { PostComposerDialog } from "./PostComposerDialog";

interface Props {
    client: MatrixClient;
    onFinished: (sent?: boolean) => void;
    /** Prefills the composer body - used by the "#/social?post=1&text=..." deep link (see
     *  pendingPostModal.ts). */
    initialBody?: string;
}

export function PostDialog({ client, onFinished, initialBody }: Props): JSX.Element {
    const handleSubmit = useCallback(
        async (body: string, targetRoomId: string): Promise<void> => {
            await sendPost(client, targetRoomId, body);
        },
        [client],
    );

    return (
        <PostComposerDialog
            client={client}
            title="Post"
            placeholder="What's on your mind?"
            sendButtonTitle="Post"
            initialBody={initialBody}
            onSubmit={handleSubmit}
            onFinished={onFinished}
        />
    );
}
