import { describe, it, expect } from "vitest";

import { toGreentextHTML } from "./greentext";

describe("toGreentextHTML", () => {
    it("preserves internal line breaks inside a fenced code block", () => {
        const message = '```\n{\n  "a": 1,\n  "b": 2\n}\n```';
        const html = toGreentextHTML(message);
        expect(html).toContain("{\n  &quot;a&quot;: 1,\n  &quot;b&quot;: 2\n}");
    });

    it("renders a blockquote as a colored font tag with no stray blank lines around it", () => {
        const message = "> hello\n> world\n\nafter";
        const html = toGreentextHTML(message);
        expect(html.trim()).toBe('<font color="#789922"><p>&gt;hello<br />&gt;world</p></font><p>after</p>');
    });

    it("keeps ordinary multi-line text flowing via <br /> outside of any blockquote", () => {
        const message = "line one\nline two";
        const html = toGreentextHTML(message);
        expect(html).toContain("line one<br />line two");
    });
});
