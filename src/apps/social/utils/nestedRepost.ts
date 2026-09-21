/*
 * Social Overlay - nestedRepost
 *
 * A repost of a repost. The snapshot embedded in the outer repost is itself a post that reposted
 * something else, and its own relates_to survives inside the snapshot when the outer relation is a
 * normal (non-content_inline) one. Rendered flat, that snapshot's own text/media - which, for a
 * boost, is really the *original* author's - ends up under the middle reposter's name, as though
 * they'd said it. So SocialEventTile splits it: the card shows the middle reposter, and the original
 * post renders in a second, nested card under its own "reposted X's post" line.
 *
 * The decisions about *when* that applies live here (pure, so they can be tested without rendering
 * the whole tile); SocialEventTile only renders the result.
 */

import { hasPostBodyOverride } from "./postBody";
import { MSC4501_RELATES_TO_KEY, MSC4501_REL_TYPE_REPOST } from "./room-classifier";

type Content = Record<string, any>;

/** The subset of an MSC4501 repost relation this cares about. */
export interface RepostRelation {
    rel_type?: string;
    content_inline?: boolean;
    content?: Content;
    [key: string]: any;
}

export interface NestedRepost {
    /** The middle reposter's relation to the original post (the one nested inside the snapshot). */
    relation: RepostRelation;
    /** The original post's own content snapshot, before body resolution/header stripping. */
    sourceContent: Content;
    /**
     * Whether the middle reposter's own snapshot has anything of its own to show. When the nested
     * relation was content_inline the whole snapshot *is* the original post's content, all of which
     * renders in the nested card instead, so there's nothing left for the middle card.
     */
    middleHasOwnContent: boolean;
}

/**
 * content_inline reuses a whole event's own `content` as the embedded snapshot - but that object
 * also carries a field describing the *wrapper* event itself, not the post being embedded: its own
 * relates_to. Left in, it makes the snapshot look like it's itself a repost of whatever it points at.
 * Stripped once, here, rather than at every consumer.
 */
export function withoutWrapperOnlyFields<T extends Content | undefined>(c: T): T {
    if (!c || !(MSC4501_RELATES_TO_KEY in c)) return c;
    const { [MSC4501_RELATES_TO_KEY]: _relatesTo, ...rest } = c;
    return rest as T;
}

/**
 * Works out whether the snapshot embedded in a repost is itself a repost, and if so what it
 * reposted. Only ever one level deep: whatever the nested post might be reposting in turn is never
 * looked at (this is only ever called with the outer repost's own snapshot).
 *
 * @param repostOfSourceContent the outer repost's embedded snapshot, un-resolved and un-stripped.
 * @returns undefined for an ordinary post, or a repost whose nested relation has no snapshot to show
 *   (which falls back to the plain single-card rendering).
 */
export function resolveNestedRepost(repostOfSourceContent: Content | undefined): NestedRepost | undefined {
    const candidate = repostOfSourceContent?.[MSC4501_RELATES_TO_KEY] as RepostRelation | undefined;
    if (candidate?.rel_type !== MSC4501_REL_TYPE_REPOST) return undefined;

    const sourceContent = candidate.content_inline
        ? withoutWrapperOnlyFields(repostOfSourceContent)
        : candidate.content;
    if (!sourceContent) return undefined;

    return { relation: candidate, sourceContent, middleHasOwnContent: !candidate.content_inline };
}

/**
 * Whether the middle reposter's card shows its own caption. For a plain repost (not nested) the
 * card always shows the body as before; for a nested one only a genuine MSC4501 body override the
 * middle reposter added themselves counts - never the stock permalink filler content_inline carries.
 */
export function showsMiddleRepostBody(
    nested: NestedRepost | undefined,
    repostOfSourceContent: Content | undefined,
): boolean {
    return !nested || (nested.middleHasOwnContent && hasPostBodyOverride(repostOfSourceContent));
}

/** Whether the middle reposter's card shows the media in its own snapshot (see NestedRepost.middleHasOwnContent). */
export function showsMiddleRepostMedia(nested: NestedRepost | undefined): boolean {
    return !nested || nested.middleHasOwnContent;
}
