/*
 * Haven - where each threaded post sits, remembered so a deleted post can keep its place.
 *
 * Deleting (redacting) a post strips its content, including the m.relates_to that says which post
 * it replies to and which thread it's in, and Synapse drops its relation row too. After that
 * nothing on the server says where it was, so a thread view had no way to show it, or to connect a
 * surviving reply to it back up to the thread root.
 *
 * So the parent and thread root of every threaded post are recorded the first time this client
 * sees it, from login onward, and kept in local storage. A post deleted later, even while Haven was
 * closed, can then still be placed as a "deleted post" placeholder. Posts this client never saw
 * before they were deleted can't be placed; nothing else knows where they were.
 *
 * Only used as a fallback for deleted posts: a live post's own relation is always read directly.
 */

import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { immediateParentId, threadRootId } from "./thread-relations";

const STORAGE_PREFIX = "haven_social_post_relations:";
/** About 1 MB at most; the oldest posts are dropped first. */
const MAX_ENTRIES = 8000;
const SAVE_DELAY_MS = 2000;

/** [parent post, thread root, the post's timestamp] */
type Entry = [string, string, number];

let storageKey: string | null = null;
let entries = new Map<string, Entry>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(key: string): Map<string, Entry> {
    try {
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === "object") return new Map(Object.entries(parsed as Record<string, Entry>));
    } catch {
        // Unreadable or blocked storage: start empty.
    }
    return new Map();
}

function save(): void {
    saveTimer = null;
    if (!storageKey) return;
    if (entries.size > MAX_ENTRIES) {
        const newest = [...entries].sort((a, b) => b[1][2] - a[1][2]).slice(0, MAX_ENTRIES);
        entries = new Map(newest);
    }
    try {
        localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Storage full or blocked: the in-memory copy still serves this session.
    }
}

function scheduleSave(): void {
    if (storageKey && !saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

/** Records where `event` sits if it's a threaded post that still has its content. */
export function rememberPostRelation(event: MatrixEvent): void {
    const id = event.getId();
    if (!id || event.isRedacted() || event.isSending()) return;
    const root = threadRootId(event);
    const parent = immediateParentId(event);
    if (!root || !parent) return;
    const known = entries.get(id);
    if (known && known[0] === parent && known[1] === root) return;
    entries.set(id, [parent, root, event.getTs()]);
    scheduleSave();
}

/** The post a now-deleted post replied to, if this client saw it before it was deleted. */
export function rememberedParentId(eventId: string): string | undefined {
    return entries.get(eventId)?.[0];
}

/** The thread root of a now-deleted post, if this client saw it before it was deleted. */
export function rememberedThreadRootId(eventId: string): string | undefined {
    return entries.get(eventId)?.[1];
}

/**
 * Starts recording for `client`'s user: every event from sync passes through ClientEvent.Event,
 * including ones replayed from the local cache at startup. Returns a function that stops it.
 */
export function startPostRelationMemory(client: MatrixClient): () => void {
    const userId = client.getUserId();
    if (!userId) return () => {};
    storageKey = STORAGE_PREFIX + userId;
    entries = load(storageKey);
    const onEvent = (event: MatrixEvent): void => rememberPostRelation(event);
    client.on(ClientEvent.Event, onEvent);
    return () => {
        client.off(ClientEvent.Event, onEvent);
        if (saveTimer) {
            clearTimeout(saveTimer);
            save();
        }
        storageKey = null;
        entries = new Map();
    };
}
