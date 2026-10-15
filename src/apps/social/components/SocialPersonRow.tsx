/*
 * Social Overlay - SocialPersonRow
 *
 * One person in the Search section's People tab: avatar, display name, user ID with their MSC4503
 * protocol badge, and a Follow button for their linked MSC4501 profile room. The button reads
 * Follow (public room) or Request Follow (knock room), or is greyed out saying why it can't be
 * used: Private (invite-only, or the room's summary was refused) or No Profile (nothing linked).
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type MatrixClient, type RoomMember, RoomEvent, JoinRule } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import { type Member } from "../../../../element-web/apps/web/src/utils/direct-messages";
import { fetchUserProfile, type LinkedProfileRoom, useLiveUserProfile } from "../utils/liveUserProfile";
import { ExternalHandleIcon } from "./ExternalHandleIcon";
import { withTimeout } from "../utils/social-actions";

export type FollowState =
    | { kind: "loading" }
    | { kind: "no_profile" }
    | { kind: "private" }
    | { kind: "follow" | "request"; room: LinkedProfileRoom }
    | { kind: "following" | "requested" };

/** Join rules of profile rooms we aren't in, by room ID - shared by every row, so one person
 *  appearing in several searches only costs one summary request. Null when it couldn't be read. */
const joinRuleCache = new Map<string, Promise<string | null>>();

function fetchJoinRule(client: MatrixClient, room: LinkedProfileRoom): Promise<string | null> {
    let cached = joinRuleCache.get(room.roomId);
    if (!cached) {
        cached = withTimeout(client.getRoomSummary(room.roomId, room.via), 15_000).then(
            (summary) => (summary.join_rule as unknown as string | undefined) ?? null,
            () => null,
        );
        joinRuleCache.set(room.roomId, cached);
    }
    return cached;
}

/** Works out what the Follow button should offer for `userId` - see FollowState. */
export async function resolveFollowState(client: MatrixClient, userId: string): Promise<FollowState> {
    const { profileRoom } = await fetchUserProfile(client, userId);
    if (!profileRoom) return { kind: "no_profile" };

    const membership = client.getRoom(profileRoom.roomId)?.getMyMembership();
    if (membership === KnownMembership.Join) return { kind: "following" };
    if (membership === KnownMembership.Knock) return { kind: "requested" };

    const joinRule = await fetchJoinRule(client, profileRoom);
    if (joinRule === JoinRule.Public) return { kind: "follow", room: profileRoom };
    if (joinRule === JoinRule.Knock || joinRule === "knock_restricted") return { kind: "request", room: profileRoom };
    return { kind: "private" };
}

function useFollowState(client: MatrixClient, userId: string): [FollowState, (state: FollowState) => void] {
    const [state, setState] = useState<FollowState>({ kind: "loading" });

    useEffect(() => {
        let cancelled = false;
        const update = (): void => {
            void resolveFollowState(client, userId).then((next) => {
                if (!cancelled) setState(next);
            });
        };
        update();
        // Following, requesting, or the owner accepting a request all change our membership
        client.on(RoomEvent.MyMembership, update);
        return () => {
            cancelled = true;
            client.off(RoomEvent.MyMembership, update);
        };
    }, [client, userId]);

    return [state, setState];
}

const LABELS: Record<FollowState["kind"], string> = {
    loading: "Follow",
    no_profile: "No Profile",
    private: "Private",
    follow: "Follow",
    request: "Request Follow",
    following: "Following",
    requested: "Requested",
};

const TITLES: Partial<Record<FollowState["kind"], string>> = {
    no_profile: "This person hasn't linked a profile",
    private: "This profile is private",
};

interface Props {
    client: MatrixClient;
    member: Member | RoomMember;
    onViewUser: (userId: string) => void;
}

export function SocialPersonRow({ client, member, onViewUser }: Props): JSX.Element {
    const liveProfile = useLiveUserProfile(client, member.userId);
    const [followState, setFollowState] = useFollowState(client, member.userId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const avatarMxc = member.getMxcAvatarUrl() ?? liveProfile?.avatarUrl;
    const avatarUrl = avatarMxc ? (client.mxcUrlToHttp(avatarMxc, 40, 40, "crop") ?? undefined) : undefined;
    const name = member.name && member.name !== member.userId ? member.name : (liveProfile?.displayName ?? member.userId);

    const onFollow = useCallback(async () => {
        if (followState.kind !== "follow" && followState.kind !== "request") return;
        const { roomId, via } = followState.room;
        setBusy(true);
        setError(null);
        try {
            if (followState.kind === "follow") {
                await client.joinRoom(roomId, { viaServers: via });
                setFollowState({ kind: "following" });
            } else {
                await client.knockRoom(roomId, { viaServers: via });
                setFollowState({ kind: "requested" });
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to follow");
        } finally {
            setBusy(false);
        }
    }, [client, followState, setFollowState]);

    const canFollow = followState.kind === "follow" || followState.kind === "request";

    return (
        <div className="social_PersonRow">
            <button type="button" className="social_PersonRow_main" onClick={() => onViewUser(member.userId)}>
                <BaseAvatar name={name} idName={member.userId} url={avatarUrl} size="40px" />
                <div className="social_PersonRow_text">
                    <span className="social_PersonRow_name">{name}</span>
                    <span className="social_PersonRow_id">
                        <span className="social_PersonRow_mxid">{member.userId}</span>
                        <ExternalHandleIcon externalHandle={liveProfile?.externalHandle} />
                    </span>
                </div>
            </button>
            <button
                type="button"
                className={`social_ActionBtn social_PersonRow_follow${canFollow ? " social_ActionBtn--primary" : ""}`}
                disabled={!canFollow || busy}
                title={error ?? TITLES[followState.kind]}
                onClick={() => void onFollow()}
            >
                {LABELS[followState.kind]}
            </button>
        </div>
    );
}
