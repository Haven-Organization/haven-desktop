import { describe, it, expect, vi, beforeEach } from "vitest";
import { type MatrixClient, KnownMembership, MatrixError } from "matrix-js-sdk/src/matrix";

import { isStaleInviteError, rejectInvite, RETRY_DELAYS_MS } from "./inviteRejection";

function matrixError(httpStatus: number, errcode: string): MatrixError {
    return new MatrixError({ errcode, error: `${errcode} happened` }, httpStatus);
}

describe("isStaleInviteError", () => {
    it("treats the server's not-invited answers as stale", () => {
        expect(isStaleInviteError(matrixError(404, "M_NOT_FOUND"))).toBe(true);
        expect(isStaleInviteError(matrixError(403, "M_FORBIDDEN"))).toBe(true);
        expect(isStaleInviteError(matrixError(400, "M_UNKNOWN"))).toBe(true);
    });

    it("leaves errors about this session or the server alone", () => {
        expect(isStaleInviteError(matrixError(429, "M_LIMIT_EXCEEDED"))).toBe(false);
        expect(isStaleInviteError(matrixError(401, "M_UNKNOWN_TOKEN"))).toBe(false);
        expect(isStaleInviteError(matrixError(403, "M_CONSENT_NOT_GIVEN"))).toBe(false);
        expect(isStaleInviteError(matrixError(502, "M_UNKNOWN"))).toBe(false);
        expect(isStaleInviteError(new Error("network down"))).toBe(false);
    });
});

describe("rejectInvite", () => {
    const roomId = "!room:example.org";
    let membership: string;
    let client: MatrixClient;
    let leave: ReturnType<typeof vi.fn>;
    let setSyncData: ReturnType<typeof vi.fn>;
    let save: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        membership = KnownMembership.Invite;
        leave = vi.fn().mockResolvedValue({});
        setSyncData = vi.fn().mockResolvedValue(undefined);
        save = vi.fn().mockResolvedValue(undefined);
        const room = {
            getMyMembership: () => membership,
            updateMyMembership: (m: string) => (membership = m),
        };
        client = {
            leave,
            getRoom: () => room,
            store: { getSyncToken: () => "s123", setSyncData, save },
        } as unknown as MatrixClient;
    });

    function expectDroppedLocally(): void {
        expect(membership).toBe(KnownMembership.Leave);
        expect(setSyncData).toHaveBeenCalledWith(
            expect.objectContaining({
                next_batch: "s123",
                rooms: expect.objectContaining({ leave: { [roomId]: expect.anything() } }),
            }),
        );
        expect(save).toHaveBeenCalledWith(true);
    }

    it("drops the invite locally after a successful rejection", async () => {
        await rejectInvite(client, roomId);
        expect(leave).toHaveBeenCalledWith(roomId);
        expectDroppedLocally();
    });

    it("drops the invite locally when the server no longer has it", async () => {
        leave.mockRejectedValue(matrixError(404, "M_NOT_FOUND"));
        await expect(rejectInvite(client, roomId)).resolves.toBeUndefined();
        expectDroppedLocally();
    });

    it("drops the invite locally and retries other errors in the background", async () => {
        vi.useFakeTimers();
        try {
            leave.mockRejectedValueOnce(matrixError(502, "M_UNKNOWN"));
            leave.mockRejectedValueOnce(new Error("network down"));
            await expect(rejectInvite(client, roomId)).resolves.toBeUndefined();
            expectDroppedLocally();
            expect(leave).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
            expect(leave).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
            expect(leave).toHaveBeenCalledTimes(3);
            await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(leave).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("doesn't retry once the server says the invite is gone", async () => {
        vi.useFakeTimers();
        try {
            leave.mockRejectedValueOnce(matrixError(503, "M_UNKNOWN"));
            leave.mockRejectedValueOnce(matrixError(403, "M_FORBIDDEN"));
            await rejectInvite(client, "!other:example.org");
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
            await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(leave).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
