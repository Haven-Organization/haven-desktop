// Haven: mentions go to the translation site as names, not as Matrix IDs it mistakes for web addresses.
import { describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { mentionsAsNames } from "./mentionNames";

function roomWith(names: Record<string, string>): Room {
    return { getMember: (userId: string) => (names[userId] ? { rawDisplayName: names[userId] } : null) } as unknown as Room;
}

describe("mentionsAsNames", () => {
    it("uses the mentioned user's display name in the room", () => {
        const room = roomWith({ "@claude:glowers.club": "Claude" });
        expect(mentionsAsNames("@claude:glowers.club　行きましょ", room)).toBe("Claude　行きましょ");
    });

    it("uses the localpart when the room doesn't have them, or there's no room", () => {
        expect(mentionsAsNames("@someone:example.org:8448 行きましょ", roomWith({}))).toBe("someone 行きましょ");
        expect(mentionsAsNames("hi @claude:glowers.club!", undefined)).toBe("hi claude!");
    });

    it("leaves text without mentions alone", () => {
        expect(mentionsAsNames("email me at a@b.com, it's 10:30", undefined)).toBe("email me at a@b.com, it's 10:30");
    });
});
