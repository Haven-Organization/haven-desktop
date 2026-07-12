/*
 * Haven — bridged-topic HTML fallback
 *
 * Some bridges (e.g. matrix-appservice-activitypub, mirroring a Fediverse bio into a room topic)
 * set the plain m.room.topic `topic` field directly to a string containing real HTML markup,
 * rather than using MSC3765's separate extensible "m.topic" text/html representations - so
 * matrix-js-sdk's ContentHelpers.parseTopicContent (see useTopic.ts) never populates a `html`
 * field for these, and the raw tags would otherwise show up literally as visible text. This
 * detects that case and promotes the plain text into the html slot too, so the existing (safe,
 * reduced-tag) topic sanitizer already in HtmlUtils.tsx's topicToHtml renders it properly instead
 * of showing raw markup.
 */

// A deliberately loose heuristic - matches an opening tag like "<p>", "<a href="...">", "<br>".
// A false positive here just means sanitizeHtml runs over already-plain text (harmless, since an
// unmatched "<" is escaped/stripped); a false negative just leaves the existing raw-text behavior.
const LOOKS_LIKE_HTML = /<[a-z][^>]*>/i;

export function withBridgedHtmlFallback<T extends { text?: string; html?: string }>(topic: T | null): T | null {
    if (!topic || topic.html || !topic.text) return topic;
    if (!LOOKS_LIKE_HTML.test(topic.text)) return topic;
    return { ...topic, html: topic.text };
}
