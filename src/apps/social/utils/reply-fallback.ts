/** Strip the Matrix reply fallback prefix ("> <@sender> text\n> ...\n\n") from a body. */
export function stripReplyFallback(body: string): string {
    if (!body.startsWith("> ")) return body;
    const idx = body.indexOf("\n\n");
    if (idx === -1) return body;
    return body.slice(idx + 2);
}
