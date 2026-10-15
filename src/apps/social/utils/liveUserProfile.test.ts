import { describe, it, expect } from "vitest";
import { User } from "matrix-js-sdk/src/matrix";

import { fillUserFromProfile } from "./liveUserProfile";

describe("fillUserFromProfile", () => {
    const userId = "@someone:example.com";

    it("fills a bare user's name and avatar from the profile without touching the original", () => {
        const user = new User(userId);
        user.presence = "online";

        const filled = fillUserFromProfile(user, { displayName: "Someone", avatarUrl: "mxc://example.com/a" });

        expect(filled).not.toBe(user);
        expect(filled.userId).toBe(userId);
        expect(filled.rawDisplayName).toBe("Someone");
        expect(filled.displayName).toBe("Someone");
        expect(filled.avatarUrl).toBe("mxc://example.com/a");
        expect(filled.presence).toBe("online");
        expect(user.rawDisplayName).toBe(userId);
        expect(user.avatarUrl).toBeUndefined();
    });

    it("keeps a name and avatar the user already has", () => {
        const user = new User(userId);
        user.setRawDisplayName("Known Name");
        user.setDisplayName("Known Name");
        user.setAvatarUrl("mxc://example.com/known");

        expect(fillUserFromProfile(user, { displayName: "Other", avatarUrl: "mxc://example.com/other" })).toBe(user);
    });

    it("fills only the avatar when the user already has a name", () => {
        const user = new User(userId);
        user.setRawDisplayName("Known Name");
        user.setDisplayName("Known Name");

        const filled = fillUserFromProfile(user, { displayName: "Other", avatarUrl: "mxc://example.com/a" });

        expect(filled.rawDisplayName).toBe("Known Name");
        expect(filled.avatarUrl).toBe("mxc://example.com/a");
    });

    it("returns the user unchanged when there is no profile or it has nothing to add", () => {
        const user = new User(userId);
        expect(fillUserFromProfile(user, null)).toBe(user);
        expect(fillUserFromProfile(user, {})).toBe(user);
    });
});
