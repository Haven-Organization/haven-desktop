/*
 * Haven — greentext rendering
 *
 * Shared by both Social's own post composer (socialSlashCommands.ts) and the stock room message
 * composer (a small patch on element-web's own editor/serialize.ts) - the "haven.blockquote_style"
 * config option controls both the same way, since a host choosing greentext almost certainly wants
 * it everywhere blockquotes render, not just inside Social.
 */

import * as commonmark from "commonmark";

// Matches the glowers.club element-web-patches repo's own greentext.patch exactly.
const GREENTEXT_COLOR = "#789922";

/**
 * Re-inserts the literal "> " marker onto the first text of each line within a block_quote node.
 * commonmark's own parser strips this marker when building the blockquote's child paragraph (that's
 * how blockquotes work in standard markdown), but greentext isn't really a blockquote semantically -
 * it's the marker itself, kept visible, just recolored. Only walks in far enough to find each line's
 * leading text node: a softbreak/linebreak starts a new line within the same blockquote, so both the
 * very first line and every line after one of those get the marker restored.
 */
function reinsertQuoteMarkers(parsed: commonmark.Node): void {
    const walker = parsed.walker();
    let step: commonmark.NodeWalkingStep | null;
    let blockQuoteDepth = 0;
    let atLineStart = false;
    while ((step = walker.next())) {
        const { node, entering } = step;
        if (node.type === "block_quote") {
            // Don't touch atLineStart here - paragraph (a child, entered right after) is what
            // actually marks a fresh line below, since a bare block_quote entry doesn't itself
            // carry any text.
            blockQuoteDepth += entering ? 1 : -1;
            continue;
        }
        if (blockQuoteDepth === 0) continue;
        if (!entering) continue;
        if (node.type === "paragraph" || node.type === "softbreak" || node.type === "linebreak") {
            // A new paragraph (a fresh quoted line, or a subsequent one after a blank line within
            // the same blockquote) or a soft/hard break within one both start a new line - the very
            // next text node reached is that line's own leading text, whatever marker belongs to it.
            atLineStart = true;
            continue;
        }
        if (node.type === "text") {
            if (atLineStart) node.literal = ">" + (node.literal ?? "");
            atLineStart = false;
        } else {
            // Some other inline node (emph, strong, code, link, etc.) starts the line instead of
            // plain text - nothing to prepend onto directly, just stop treating this as a line
            // start once we've moved past whatever opens the line.
            atLineStart = false;
        }
    }
}

/**
 * Same commonmark HtmlRenderer stock's own Markdown.toHTML() builds (safe: false, softbreak as a
 * real <br/> - see editor/Markdown.ts), just with block_quote's own render function overridden
 * (commonmark.HtmlRenderer dispatches per node.type via `this[node.type]`, so replacing this one
 * function on the instance is enough - no need to touch commonmark's own source, unlike the
 * upstream patch this mirrors, which edits node_modules/commonmark directly and would get silently
 * lost on the next dependency update). Renders a <font color="#789922"> tag instead of the usual
 * <blockquote> - a colored, unboxed, unindented line rather than a real blockquote's usual left
 * border/indent.
 *
 * commonmark's own cr() (called the same way stock's block_quote/paragraph renderers call it)
 * emits a literal "\n" before/after a tag purely to pretty-print the raw HTML - invisible once
 * collapsed between two block-level boxes (that's what makes it a no-op for a real <blockquote>),
 * but <font> is inline by default, so that same "\n" lands inside Element's message body, which
 * preserves whitespace (white-space: pre-wrap) - showing up as a genuine extra blank line. None of
 * these newlines carry meaning (an intentional line break is always a "<br />" from the softbreak
 * option below, never a raw "\n"), so stripping every literal "\n" from the rendered output is safe
 * and removes the extra line at the source instead of just hiding it visually.
 */
export function toGreentextHTML(message: string): string {
    const parser = new commonmark.Parser();
    const parsed = parser.parse(message);
    reinsertQuoteMarkers(parsed);

    const renderer = new commonmark.HtmlRenderer({ safe: false, softbreak: "<br />" });
    renderer.block_quote = function (this: commonmark.HtmlRenderer, _node: commonmark.Node, entering: boolean) {
        this.cr();
        this.tag(entering ? "font" : "/font", entering ? [["color", GREENTEXT_COLOR]] : undefined);
        this.cr();
    };
    return renderer.render(parsed).replace(/\n/g, "");
}
