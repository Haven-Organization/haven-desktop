// @vitest-environment happy-dom
// Haven: the "Post to" picker lists only rooms you can post in. Following someone joins their
// profile room, which usually only they can post in, and picking it used to fail silently.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "test-utils-rtl";
import { type Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, mkStubRoom } from "test-utils";

import { RoomPickerModal } from "./RoomPickerModal";
import { MSC4501_ROOM_TYPE_PROFILE } from "../utils/room-classifier";

// Each row's avatar and context line need DM and space stores this test doesn't set up.
vi.mock("../../../../element-web/apps/web/src/components/views/avatars/DecoratedRoomAvatar", () => ({
    default: () => null,
}));
vi.mock("../../../../element-web/apps/web/src/components/views/rooms/RoomContextDetails", () => ({
    RoomContextDetails: () => null,
}));

function profileRoom(roomId: string, name: string, canPost: boolean): Room {
    const room = mkStubRoom(roomId, name, createTestClient());
    vi.mocked(room.currentState.getStateEvents).mockImplementation(((type: string, key?: string) =>
        type === "m.room.create" && key === ""
            ? { getContent: () => ({ type: MSC4501_ROOM_TYPE_PROFILE }) }
            : key === undefined
              ? []
              : null) as any);
    vi.mocked(room.currentState.maySendEvent).mockReturnValue(canPost);
    return room;
}

describe("RoomPickerModal", () => {
    it("lists only the social rooms you can post in", () => {
        const client = createTestClient();
        const mine = profileRoom("!mine:example.org", "My profile", true);
        const followed = profileRoom("!followed:example.org", "Someone I follow", false);
        client.getVisibleRooms = vi.fn().mockReturnValue([mine, followed]);

        render(<RoomPickerModal client={client} onFinished={vi.fn()} />);

        expect(screen.getByText("My profile")).toBeInTheDocument();
        expect(screen.queryByText("Someone I follow")).not.toBeInTheDocument();
    });
});
