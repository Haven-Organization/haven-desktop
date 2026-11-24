/*
 * Social Overlay — postBody
 *
 * MSC4501's org.matrix.msc4501.social.body / org.matrix.msc4501.social.formatted_body take
 * priority over the stock body/formatted_body fields whenever they're present - including when
 * set to an empty string, which is how a sender says "show no text here as a post" (e.g. a plain
 * boost whose stock body/formatted_body spell out "🔁 X reposted Y's post" for ordinary room
 * timelines). MSC4501 says to render them "in place of" the stock fields, with no non-empty
 * condition. Applies on any content object Social renders as post content - a post's own content,
 * or a repost/reply's embedded content snapshot (relates_to.content, or the outer event's own
 * content when content_inline is true). This is the one place that priority rule is actually
 * applied; every display site should resolve through this rather than reading body/formatted_body
 * off a content object directly.
 */

import { MSC4501_BODY_KEY, MSC4501_FORMATTED_BODY_KEY } from "./room-classifier";

/** Present at all (any string, empty included) - enough for the field to override its stock
 *  counterpart. */
function isSet(value: unknown): value is string {
    return typeof value === "string";
}

/** Present with actual text - see hasPostBodyOverride for where that distinction matters. */
function filledOut(value: unknown): value is string {
    return typeof value === "string" && value !== "";
}

/** Returns a shallow copy of `content` with body/formatted_body overridden by their
 *  org.matrix.msc4501.social.* counterparts when those are present (an empty one blanks out its
 *  stock field) - unchanged (same reference) otherwise, so callers relying on referential equality
 *  (e.g. useMemo/useEffect deps elsewhere) don't see spurious changes. Forces format to
 *  org.matrix.custom.html when substituting in a formatted_body override, since a plain-text stock
 *  body's content wouldn't otherwise have this set, and the HTML-rendering pipeline gates on it.
 *  A social.body with no social.formatted_body drops the stock formatted_body and format, so the
 *  plain override is what shows. */
export function resolvePostBody<T extends Record<string, any> | undefined>(content: T): T {
    if (!content) return content;
    const bodyOverride = content[MSC4501_BODY_KEY];
    const formattedBodyOverride = content[MSC4501_FORMATTED_BODY_KEY];
    if (!isSet(bodyOverride) && !isSet(formattedBodyOverride)) return content;

    const resolved: Record<string, any> = { ...content };
    if (isSet(bodyOverride)) resolved.body = bodyOverride;
    if (isSet(formattedBodyOverride)) {
        resolved.formatted_body = formattedBodyOverride;
        resolved.format = "org.matrix.custom.html";
    } else {
        // social.body alone replaces the text, HTML included: the stock formatted_body is the
        // ordinary-timeline version, with a bridge's header line ("🔁 X boosted Y's post:").
        delete resolved.formatted_body;
        delete resolved.format;
    }
    return resolved as T;
}

/** Just the effective body string (MSC4501_BODY_KEY if present, even empty, else stock body) -
 *  for call sites that only ever wanted the plain string, not a whole resolved content object. */
export function resolvePostBodyString(content: Record<string, any> | undefined): string {
    const override = content?.[MSC4501_BODY_KEY];
    return isSet(override) ? override : (content?.body ?? "");
}

/** True when `content` has either MSC4501 body override with actual text - i.e. a real caption
 *  worth rendering. An empty override still replaces the stock fields (see resolvePostBody), but
 *  isn't a caption, so it doesn't count here - callers use this to decide whether to show a text
 *  block at all. */
export function hasPostBodyOverride(content: Record<string, any> | undefined): boolean {
    return filledOut(content?.[MSC4501_BODY_KEY]) || filledOut(content?.[MSC4501_FORMATTED_BODY_KEY]);
}

/** True when `content` carries either MSC4501 body override field at all, even empty. A sender
 *  using these fields has no redundant header text in its stock body/formatted_body to strip or
 *  treat as a caption, so software.haven.remove_header (a backwards-compat flag from before these
 *  fields existed) and the stock formatted_body caption check should never be considered once
 *  either is present - see stripHavenHeader and boostHasCaption in SocialEventTile.tsx. */
export function hasPostBodyOverrideField(content: Record<string, any> | undefined): boolean {
    return isSet(content?.[MSC4501_BODY_KEY]) || isSet(content?.[MSC4501_FORMATTED_BODY_KEY]);
}

/** True when `content` carries both MSC4501 body override fields and both are empty - a sender
 *  saying this post has no text of its own in Social. On a repost, that makes it a plain repost
 *  whatever its stock body says (see isBoost in SocialEventTile.tsx). */
export function hasEmptyPostBodyOverrides(content: Record<string, any> | undefined): boolean {
    return content?.[MSC4501_BODY_KEY] === "" && content?.[MSC4501_FORMATTED_BODY_KEY] === "";
}
