// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { mkStubRoom, stubClient, withClientContextRenderOptions } from "test-utils";

import MutualRoomsDialog, { MUTUAL_ROOMS_PAGE_SIZE } from "./MutualRoomsDialog";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import DMRoomMap from "../../../utils/DMRoomMap";

describe("<MutualRoomsDialog />", () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    let client: MatrixClient;

    beforeEach(() => {
        client = stubClient();
        DMRoomMap.makeShared(client);
        observerCallback = undefined;
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                public constructor(callback: IntersectionObserverCallback) {
                    observerCallback = callback;
                }
                public observe(): void {}
                public disconnect(): void {}
            },
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const makeRooms = (count: number): Room[] =>
        Array.from({ length: count }, (_, i) => {
            const r = mkStubRoom(`!room${i}:example.com`, `Room ${i}`, client);
            r.getCanonicalAlias = () => (i === 0 ? "#first:example.com" : null);
            r.getAltAliases = () => [];
            return r;
        });

    const renderDialog = (rooms: Room[], onFinished = vi.fn()) =>
        render(<MutualRoomsDialog rooms={rooms} onFinished={onFinished} />, withClientContextRenderOptions(client));

    it("shows each room's alias, or its room ID when it has none", () => {
        renderDialog(makeRooms(2));
        expect(screen.getByText("#first:example.com")).toBeInTheDocument();
        expect(screen.getByText("!room1:example.com")).toBeInTheDocument();
    });

    it("filters the list from the search box", async () => {
        renderDialog(makeRooms(3));
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "#first" } });
        await screen.findByText("#first:example.com");
        await vi.waitFor(() => expect(screen.queryByText("!room1:example.com")).not.toBeInTheDocument());
    });

    it("renders a page at a time as the list scrolls", () => {
        renderDialog(makeRooms(MUTUAL_ROOMS_PAGE_SIZE + 5));
        expect(screen.getAllByRole("button", { name: /Room \d+/ })).toHaveLength(MUTUAL_ROOMS_PAGE_SIZE);

        act(() => observerCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as any));
        expect(screen.getAllByRole("button", { name: /Room \d+/ })).toHaveLength(MUTUAL_ROOMS_PAGE_SIZE + 5);
    });

    it("opens a room when it is clicked", () => {
        const dispatch = vi.spyOn(dis, "dispatch").mockImplementation(() => {});
        const onFinished = vi.fn();
        renderDialog(makeRooms(1), onFinished);

        fireEvent.click(screen.getByRole("button", { name: /Room 0/ }));

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!room0:example.com" }),
        );
        expect(onFinished).toHaveBeenCalled();
    });
});
