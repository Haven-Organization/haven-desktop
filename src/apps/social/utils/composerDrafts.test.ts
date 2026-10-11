/*
 * Social Overlay - composerDrafts tests
 *
 * A half-written post has to survive the Social view unmounting (switching to a room and back) -
 * see composerDrafts.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { renderHook, act } from "test-utils-rtl";

import { peekComposerDraft, roomComposerDraftKey, useComposerDraft } from "./composerDrafts";
import { usePendingAttachment } from "./postAttachment";

describe("useComposerDraft", () => {
    it("restores the text after the composer unmounts and mounts again", () => {
        const first = renderHook(() => useComposerDraft("test:remount"));
        act(() => first.result.current[1]("half-written post"));
        first.unmount();

        const second = renderHook(() => useComposerDraft("test:remount"));
        expect(second.result.current[0]).toBe("half-written post");
    });

    it("supports functional updates, like useState", () => {
        const { result } = renderHook(() => useComposerDraft("test:functional"));
        act(() => result.current[1]("hello"));
        act(() => result.current[1]((body) => body + " world"));
        expect(result.current[0]).toBe("hello world");
        expect(peekComposerDraft("test:functional")).toBe("hello world");
    });

    it("forgets the draft once the text is cleared (e.g. after posting)", () => {
        const first = renderHook(() => useComposerDraft("test:cleared"));
        act(() => first.result.current[1]("about to post"));
        act(() => first.result.current[1](""));
        first.unmount();

        const second = renderHook(() => useComposerDraft("test:cleared"));
        expect(second.result.current[0]).toBe("");
    });

    it("keeps each page's draft separate", () => {
        const feed = renderHook(() => useComposerDraft("test:feed"));
        const room = renderHook(() => useComposerDraft(roomComposerDraftKey("!room:example.org")));
        act(() => feed.result.current[1]("feed text"));
        expect(room.result.current[0]).toBe("");
        expect(peekComposerDraft(roomComposerDraftKey("!room:example.org"))).toBe("");
    });
});

describe("usePendingAttachment with a draft key", () => {
    const file = (name: string): File => new File(["x"], name, { type: "text/plain" });

    it("restores the staged file after the composer unmounts and mounts again", () => {
        const first = renderHook(() => usePendingAttachment("test:file-remount"));
        act(() => first.result.current.setFile(file("picture.txt")));
        first.unmount();

        const second = renderHook(() => usePendingAttachment("test:file-remount"));
        expect(second.result.current.attachment?.file.name).toBe("picture.txt");
    });

    it("forgets the staged file once cleared (e.g. after posting)", () => {
        const first = renderHook(() => usePendingAttachment("test:file-cleared"));
        act(() => first.result.current.setFile(file("picture.txt")));
        act(() => first.result.current.clear());
        first.unmount();

        const second = renderHook(() => usePendingAttachment("test:file-cleared"));
        expect(second.result.current.attachment).toBeNull();
    });

    it("keeps nothing without a draft key (dialogs)", () => {
        const first = renderHook(() => usePendingAttachment());
        act(() => first.result.current.setFile(file("picture.txt")));
        first.unmount();

        const second = renderHook(() => usePendingAttachment());
        expect(second.result.current.attachment).toBeNull();
    });
});
