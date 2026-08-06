import { describe, it, expect } from "vitest";

import { saveLastSocialViewState, peekLastSocialViewState } from "./lastSocialViewState";

describe("lastSocialViewState", () => {
    it("has nothing saved until saveLastSocialViewState is called", () => {
        // This module is a session-lifetime cache with no clear() - other test files sharing this
        // module could leave state behind, so don't assert null here; just confirm saving/reading
        // works below.
        const nav = { section: "feed" as const };
        saveLastSocialViewState(nav, 123);
        expect(peekLastSocialViewState()).toEqual({ nav, scrollTop: 123 });
    });

    it("peeks non-destructively - reading it twice returns the same value both times", () => {
        const nav = { section: "groups" as const };
        saveLastSocialViewState(nav, 456);
        expect(peekLastSocialViewState()).toEqual({ nav, scrollTop: 456 });
        expect(peekLastSocialViewState()).toEqual({ nav, scrollTop: 456 });
    });

    it("a later save overwrites an earlier one", () => {
        saveLastSocialViewState({ section: "feed" }, 10);
        const nav = { section: "profile" as const, roomId: "!room:server" };
        saveLastSocialViewState(nav, 789);
        expect(peekLastSocialViewState()).toEqual({ nav, scrollTop: 789 });
    });
});
