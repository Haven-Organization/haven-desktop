/*
 * Haven: regression coverage for :shortcode: emoji autocomplete inserting the user's skin tone.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import { stubClient, mkStubRoom } from "test-utils";

import EmojiProvider from "./EmojiProvider";
import SettingsStore from "../settings/SettingsStore";
import { MatrixClientPeg } from "../MatrixClientPeg";

describe("EmojiProvider skin tone", () => {
    const client = stubClient();
    // The provider also reads the room's client (for the user's favorite image packs).
    const testRoom = mkStubRoom("!room:example.org", "Room", client);
    MatrixClientPeg.safeGet();
    const range = { beginning: true, start: 0, end: 3 };

    const withTone = (tone: string): void => {
        settingsSpy = vi
            .spyOn(SettingsStore, "getValue")
            .mockImplementation((name) => {
                if (name === "Haven.emojiSkinTone") return tone as any;
                if (name === "MessageComposerInput.suggestEmoji")
                    return true as any;
                return undefined as any;
            });
    };

    // Restore just the settings spy - restoreAllMocks() would also undo stubClient()'s own mocks.
    let settingsSpy: ReturnType<typeof vi.spyOn> | undefined;
    afterEach(() => settingsSpy?.mockRestore());

    it("inserts the emoji untoned by default", async () => {
        withTone("none");
        const [first] = await new EmojiProvider(testRoom).getCompletions(
            ":+1:",
            range
        );
        expect(first.completion).toBe("👍️");
    });

    it.each([
        ["light", "🏻"],
        ["medium-light", "🏼"],
        ["medium", "🏽"],
        ["medium-dark", "🏾"],
        ["dark", "🏿"],
    ])(
        "inserts the %s tone for emoji that have skin variants",
        async (tone, modifier) => {
            withTone(tone);
            const [first] = await new EmojiProvider(testRoom).getCompletions(
                ":+1:",
                range
            );
            expect(first.completion).toBe(`👍${modifier}`);
        }
    );

    it("leaves emoji without skin variants alone", async () => {
        withTone("dark");
        const [first] = await new EmojiProvider(testRoom).getCompletions(
            ":rocket:",
            range
        );
        expect(first.completion).toBe("🚀");
    });
});
