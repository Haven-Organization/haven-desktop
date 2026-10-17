/*
 * Social Overlay - mentionPills
 *
 * Turns "@user:server" and "#alias:server" text in a Social post into the same pill links the
 * stock composer sends for a completed mention, plus the m.mentions block that goes with them.
 *
 * Social's composers are plain textareas, so a mention chosen from ComposerAutocomplete is just
 * the Matrix ID or alias as text (see toPlainText there). Without this, it went out as plain text
 * with no formatted_body, so other clients showed the raw ID instead of a pill and the mentioned
 * user was never notified. Stock serializes a user pill as `[display name](permalink)` and a room
 * pill as `[#alias](permalink)` (editor/serialize.ts); this produces the same links, but from the
 * finished HTML rather than the markdown source, so IDs inside code or an existing link are left
 * alone.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { findLinksInString, LinkifyMatrixOpaqueIdType } from "@element-hq/web-shared-components";

import {
    makeGenericPermalink,
    parsePermalink,
} from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";

/** Elements whose text is never turned into a pill. */
const SKIP_TAGS = new Set(["A", "CODE", "PRE"]);

/** The Matrix IDs and aliases in `text`, in order, with their character offsets. */
export function findMentions(text: string): { id: string; start: number; end: number }[] {
    return findLinksInString(text)
        .filter(
            (link) =>
                link.type === LinkifyMatrixOpaqueIdType.UserId || link.type === LinkifyMatrixOpaqueIdType.RoomAlias,
        )
        .map((link) => ({ id: link.value, start: link.start, end: link.end }));
}

/** The name a user pill's link text should carry: their name in `room`, else their profile name. */
function displayNameFor(client: MatrixClient, room: Room | null, userId: string): string {
    return room?.getMember(userId)?.rawDisplayName || client.getUser(userId)?.displayName || userId;
}

/**
 * Replaces every user ID and room alias in the text of `html` with a pill link. `changed` is
 * false (and `html` is returned untouched) when there were none.
 */
export function pillifyMentions(
    html: string,
    client: MatrixClient,
    room: Room | null,
): { html: string; changed: boolean } {
    const template = document.createElement("template");
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let skip = false;
        for (let el = node.parentElement; el; el = el.parentElement) {
            if (SKIP_TAGS.has(el.tagName)) skip = true;
        }
        if (!skip) textNodes.push(node as Text);
    }

    let changed = false;
    for (const node of textNodes) {
        const text = node.data;
        const mentions = findMentions(text);
        if (mentions.length === 0) continue;
        changed = true;
        const fragment = document.createDocumentFragment();
        let pos = 0;
        for (const { id, start, end } of mentions) {
            fragment.append(text.slice(pos, start));
            const link = document.createElement("a");
            link.href = makeGenericPermalink(id, true);
            link.textContent = id.startsWith("@") ? displayNameFor(client, room, id) : id;
            fragment.append(link);
            pos = end;
        }
        fragment.append(text.slice(pos));
        node.replaceWith(fragment);
    }
    return changed ? { html: template.innerHTML, changed } : { html, changed };
}

/**
 * Adds m.mentions for every user pill in `content.formatted_body`, as stock does for a message
 * with user pills (utils/messages.ts's attachMentions). Left out when nobody is mentioned, so a
 * post without mentions is sent exactly as before.
 */
export function attachMentions(content: Record<string, unknown>, ownUserId: string | null): void {
    const html = content.formatted_body;
    if (typeof html !== "string") return;
    const template = document.createElement("template");
    template.innerHTML = html;
    const userIds = new Set<string>();
    for (const link of template.content.querySelectorAll("a[href]")) {
        const userId = parsePermalink(link.getAttribute("href")!)?.userId;
        if (userId && userId !== ownUserId) userIds.add(userId);
    }
    if (userIds.size > 0) content["m.mentions"] = { user_ids: [...userIds] };
}
