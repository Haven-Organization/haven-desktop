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
    /** Prefills the composer body - used by the "#/social?post=1&body=..." deep link (see
     *  pendingPostModal.ts). */
    initialBody?: string;
    /** Preselects the "Post to:" room and/or stages a file into the shelf - used when this dialog
     *  is opened as the scrolled-away fallback for an inline composer (see
     *  openScrolledAwayPostModal in SocialHomeView.tsx/SocialRoomView.tsx). */
    initialRoomId?: string;
    initialFile?: File;
}

export function PostDialog({ client, onFinished, initialBody, initialRoomId, initialFile }: Props): JSX.Element {
    const handleSubmit = useCallback(
        async (body: string, targetRoomId: string, file?: File): Promise<void> => {
            await sendPost(client, targetRoomId, body, undefined, file);
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
            initialRoomId={initialRoomId}
            initialFile={initialFile}
            onSubmit={handleSubmit}
            onFinished={onFinished}
        />
    );
}
