/*
 * Social Overlay — postBody
 *
 * MSC4501's org.matrix.msc4501.social.body / org.matrix.msc4501.social.formatted_body take
 * priority over the stock body/formatted_body fields whenever they're filled out, on any content
 * object Social renders as post content - a post's own content, or a repost/reply's embedded
 * content snapshot (relates_to.content, or the outer event's own content when content_inline is
 * true). This is the one place that priority rule is actually applied; every display site should
 * resolve through this rather than reading body/formatted_body off a content object directly.
 */

import { MSC4501_BODY_KEY, MSC4501_FORMATTED_BODY_KEY } from "./room-classifier";

/** Non-empty-string check - "filled out" per MSC4501, not just present (an empty override
 *  shouldn't blank out a real stock body/formatted_body). */
function filledOut(value: unknown): value is string {
    return typeof value === "string" && value !== "";
}

/** Returns a shallow copy of `content` with body/formatted_body overridden by their
 *  org.matrix.msc4501.social.* counterparts when those are filled out - unchanged (same
 *  reference) otherwise, so callers relying on referential equality (e.g. useMemo/useEffect deps
 *  elsewhere) don't see spurious changes. Forces format to org.matrix.custom.html when
 *  substituting in a formatted_body override, since a plain-text stock body's content wouldn't
 *  otherwise have this set, and the HTML-rendering pipeline gates on it. */
export function resolvePostBody<T extends Record<string, any> | undefined>(content: T): T {
    if (!content) return content;
    const bodyOverride = content[MSC4501_BODY_KEY];
    const formattedBodyOverride = content[MSC4501_FORMATTED_BODY_KEY];
    if (!filledOut(bodyOverride) && !filledOut(formattedBodyOverride)) return content;

    return {
        ...content,
        ...(filledOut(bodyOverride) ? { body: bodyOverride } : {}),
        ...(filledOut(formattedBodyOverride)
            ? { formatted_body: formattedBodyOverride, format: "org.matrix.custom.html" }
            : {}),
    };
}

/** Just the effective body string (MSC4501_BODY_KEY if filled out, else stock body) - for call
 *  sites that only ever wanted the plain string, not a whole resolved content object. */
export function resolvePostBodyString(content: Record<string, any> | undefined): string {
    const override = content?.[MSC4501_BODY_KEY];
    return filledOut(override) ? override : (content?.body ?? "");
}

/** True when `content` has either MSC4501 body override filled out. A sender using these new
 *  fields has no redundant header text in its stock body/formatted_body left to strip in the
 *  first place, so software.haven.remove_header (a backwards-compat flag from before these fields
 *  existed) should never be considered once either is present - see stripHavenHeader's own callers
 *  in SocialEventTile.tsx, the only place remove_header is still read. */
export function hasPostBodyOverride(content: Record<string, any> | undefined): boolean {
    return filledOut(content?.[MSC4501_BODY_KEY]) || filledOut(content?.[MSC4501_FORMATTED_BODY_KEY]);
}
