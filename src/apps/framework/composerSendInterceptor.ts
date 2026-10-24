/*
 * Haven - composer send interceptor
 *
 * Stock's location sharing (shareLocation.ts) and voice messages (VoiceRecordComposerTile.tsx)
 * build their message content and send it straight away. An app composer that wants that content
 * itself instead - e.g. Social's post editor, which puts a picked location or a recorded voice
 * message into the edited post rather than sending a new one - registers an interceptor here while
 * it's open. Both stock call sites check it just before sending.
 */

export type ComposerSendInterceptor = (roomId: string, content: Record<string, unknown>) => void;

const interceptors: { roomId: string; fn: ComposerSendInterceptor }[] = [];

/**
 * Hands location and voice message content for `roomId` to `fn` instead of sending it, until the
 * returned function is called. The most recently registered interceptor for a room wins.
 */
export function registerComposerSendInterceptor(roomId: string, fn: ComposerSendInterceptor): () => void {
    const entry = { roomId, fn };
    interceptors.push(entry);
    return () => {
        const i = interceptors.indexOf(entry);
        if (i !== -1) interceptors.splice(i, 1);
    };
}

/** Returns true when an interceptor took `content`, in which case the caller must not send it. */
export function interceptComposerSend(roomId: string, content: object): boolean {
    for (let i = interceptors.length - 1; i >= 0; i--) {
        if (interceptors[i].roomId === roomId) {
            interceptors[i].fn(roomId, content as Record<string, unknown>);
            return true;
        }
    }
    return false;
}
