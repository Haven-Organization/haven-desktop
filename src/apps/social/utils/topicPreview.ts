/*
 * Social Overlay - topic preview text
 *
 * Group cards show a room's topic as a short, clamped line of plain text. A topic can carry HTML,
 * either as a proper text/html representation or as markup a bridge put straight into the plain
 * `topic` field (see bridgedTopicHtml.ts), and showing that markup as-is puts raw tags on the card.
 */

import { ContentHelpers, type MRoomTopicEventContent } from "matrix-js-sdk/src/matrix";

import { withBridgedHtmlFallback } from "../../framework/bridgedTopicHtml";

/** Block ends and <br>, after which the visible text continues on a new line. */
const LINE_ENDS = /<\/(?:p|div|li|blockquote|pre|h[1-6])>|<br\s*\/?>/gi;

/** The visible text of an HTML fragment. DOMParser builds an inert document: no scripts run and
 *  nothing loads. */
function htmlToText(html: string): string {
    const doc = new DOMParser().parseFromString(html.replace(LINE_ENDS, "$& "), "text/html");
    return doc.body.textContent ?? "";
}

/** A topic as one line of plain text for a preview, with any HTML reduced to its visible text. */
export function topicPreviewText(content: MRoomTopicEventContent | null | undefined): string {
    if (!content) return "";
    const topic = withBridgedHtmlFallback(ContentHelpers.parseTopicContent(content));
    const text = topic?.html ? htmlToText(topic.html) : (topic?.text ?? "");
    return text.replace(/\s+/g, " ").trim();
}
