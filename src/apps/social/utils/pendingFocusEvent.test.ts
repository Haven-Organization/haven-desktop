import { describe, it, expect, beforeEach } from "vitest";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { setPendingFocusEvent, peekPendingFocusEvent, clearPendingFocusEvent } from "./pendingFocusEvent";

describe("pendingFocusEvent", () => {
    beforeEach(() => {
        clearPendingFocusEvent();
    });

    it("has nothing pending until set", () => {
        expect(peekPendingFocusEvent()).toBeNull();
    });

    it("returns the event that was set", () => {
        const event = { getId: () => "$abc" } as MatrixEvent;
        setPendingFocusEvent(event);
        expect(peekPendingFocusEvent()).toBe(event);
    });

    it("peeks non-destructively - reading it twice returns the same value both times", () => {
        const event = { getId: () => "$abc" } as MatrixEvent;
        setPendingFocusEvent(event);
        expect(peekPendingFocusEvent()).toBe(event);
        expect(peekPendingFocusEvent()).toBe(event);
    });

    it("clears back to null", () => {
        setPendingFocusEvent({ getId: () => "$abc" } as MatrixEvent);
        clearPendingFocusEvent();
        expect(peekPendingFocusEvent()).toBeNull();
    });

    it("a later set overwrites an earlier one", () => {
        const first = { getId: () => "$first" } as MatrixEvent;
        const second = { getId: () => "$second" } as MatrixEvent;
        setPendingFocusEvent(first);
        setPendingFocusEvent(second);
        expect(peekPendingFocusEvent()).toBe(second);
    });
});
