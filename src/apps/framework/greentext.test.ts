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

    it("escapes text that only looks like an HTML tag instead of letting it vanish", () => {
        const html = toGreentextHTML("Bearer <admin token> and <not a tag>\n> quoted <thing>");
        expect(html).toContain("Bearer &lt;admin token&gt; and &lt;not a tag&gt;");
        expect(html).toContain("&gt;quoted &lt;thing&gt;");
    });

    it("still sends the tags Element allows as real HTML", () => {
        const html = toGreentextHTML("H<sub>2</sub>O and <del>old</del>");
        expect(html).toContain("H<sub>2</sub>O and <del>old</del>");
    });

    it("escapes a line that is only an unknown tag", () => {
        expect(toGreentextHTML("<admin token>")).toContain("&lt;admin token&gt;");
    });
});
