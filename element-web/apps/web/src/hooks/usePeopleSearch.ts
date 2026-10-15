/*
 * Haven: people search for Social's Search section, built from the same pieces Spotlight's
 * People filter uses (SpotlightDialog.tsx): members of your visible rooms, the server's user
 * directory, an exact profile lookup for a typed user ID, and Spotlight's own member ordering.
 */

import { useMemo } from "react";
import { type MatrixClient, type RoomMember } from "matrix-js-sdk/src/matrix";

import { useUserDirectory } from "./useUserDirectory";
import { useProfileInfo } from "./useProfileInfo";
import { useDebouncedCallback } from "./spotlight/useDebouncedCallback";
import { useFeatureEnabled } from "./useSettings";
import { findVisibleRoomMembers, findVisibleRooms } from "../utils/findVisibleRooms";
import { DirectoryMember, type Member } from "../utils/direct-messages";
import { buildActivityScores, buildMemberScores, compareMembers } from "../utils/SortMembers";

/** How many directory results to ask the server for, same as Spotlight's per-section limit. */
const DIRECTORY_LIMIT = 20;

export interface PeopleSearchResult {
    /** People to show: everyone you share a room with when `query` is empty, otherwise matches. */
    people: Array<Member | RoomMember>;
    /** Whether a directory or profile lookup for `query` is still running. */
    loading: boolean;
}

/**
 * Like Spotlight's People results: local room members (DMs included) matching on user ID or
 * name, merged with the server's user directory and an exact profile lookup, each person once,
 * sorted by Spotlight's activity-based member comparator.
 */
export function usePeopleSearch(cli: MatrixClient, query: string): PeopleSearchResult {
    const trimmedQuery = query.trim();
    const msc3946ProcessDynamicPredecessor = useFeatureEnabled("feature_dynamic_room_predecessors");
    const { loading: directoryLoading, users: directoryUsers, search: searchDirectory } = useUserDirectory();
    const { loading: profileLoading, profile, search: searchProfile } = useProfileInfo();

    const searchParams = useMemo(
        () => [{ query: trimmedQuery, limit: DIRECTORY_LIMIT }] as [{ query: string; limit: number }],
        [trimmedQuery],
    );
    useDebouncedCallback(!!trimmedQuery, searchDirectory, searchParams);
    useDebouncedCallback(!!trimmedQuery, searchProfile, searchParams);

    const memberComparator = useMemo(() => compareMembers(buildActivityScores(cli), buildMemberScores(cli)), [cli]);

    const people = useMemo(() => {
        const myUserId = cli.getUserId();
        const roomMembers = findVisibleRoomMembers(findVisibleRooms(cli, msc3946ProcessDynamicPredecessor), cli, false);
        const byId = new Map<string, Member | RoomMember>();

        if (!trimmedQuery) {
            for (const member of roomMembers) byId.set(member.userId, member);
        } else {
            const lcQuery = trimmedQuery.toLowerCase();
            // Local members are filtered here; directory and profile results were already matched
            // by the server, same distinction Spotlight draws with its `alreadyFiltered` flag
            for (const member of roomMembers) {
                if (member.userId.toLowerCase().includes(lcQuery) || member.name.toLowerCase().includes(lcQuery)) {
                    byId.set(member.userId, member);
                }
            }
            for (const user of directoryUsers) {
                if (!byId.has(user.userId)) byId.set(user.userId, user);
            }
            if (profile && !byId.has(profile.user_id)) byId.set(profile.user_id, new DirectoryMember(profile));
        }

        byId.delete(myUserId ?? "");
        return Array.from(byId.values()).sort(memberComparator);
    }, [cli, msc3946ProcessDynamicPredecessor, trimmedQuery, directoryUsers, profile, memberComparator]);

    return { people, loading: !!trimmedQuery && (directoryLoading || profileLoading) };
}
