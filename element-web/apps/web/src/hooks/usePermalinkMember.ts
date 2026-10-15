/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IMatrixProfile, type MatrixEvent, type Room, RoomMember } from "matrix-js-sdk/src/matrix";
import { useContext, useEffect, useState } from "react";

import { PillType } from "../components/views/elements/PillType";
import { SDKContext } from "../contexts/SDKContext";
import { type SDKContextClass } from "../contexts/SDKContextClass";
import { type PermalinkParts } from "../utils/permalinks/PermalinkConstructor";
// haven apps-framework patch
import { fetchUserProfile } from "../../../../../src/apps/social/utils/liveUserProfile";

const createMemberFromProfile = (userId: string, profile: IMatrixProfile): RoomMember => {
    const member = new RoomMember("", userId);
    member.name = profile.displayname ?? userId;
    member.rawDisplayName = member.name;
    member.events.member = {
        getContent: () => {
            return { avatar_url: profile.avatar_url };
        },
        getDirectionalContent: function () {
            return this.getContent();
        },
    } as MatrixEvent;
    return member;
};

/**
 * Tries to determine the user Id of a permalink.
 * In case of a user permalink it is the user id.
 * In case of an event permalink it is the sender user Id of the event if that event is available.
 * Otherwise returns null.
 *
 * @param type - pill type
 * @param parseResult - permalink parse result
 * @param event - permalink event, if available
 * @returns permalink user Id. null if the Id cannot be determined.
 */
const determineUserId = (
    type: PillType | null,
    parseResult: PermalinkParts | null,
    event: MatrixEvent | null,
): string | null => {
    if (type === null) return null;

    if (parseResult?.userId) return parseResult.userId;

    if (event && [PillType.EventInSameRoom, PillType.EventInOtherRoom].includes(type)) {
        return event.getSender() ?? null;
    }

    return null;
};

/** Whether a room member has neither a display name nor an avatar of its own. */
const isBareMember = (member: RoomMember): boolean =>
    (!member.rawDisplayName || member.rawDisplayName === member.userId) && !member.getMxcAvatarUrl();

/**
 * Tries to determine a RoomMember.
 *
 * @param userId - User Id to get the member for
 * @param targetRoom - permalink target room
 * @returns RoomMember of the target room if it exists.
 *          If sharing at least one room with the user, then the result will be the profile fetched via API.
 *          null in all other cases.
 */
const determineMember = (userId: string, targetRoom: Room, context: SDKContextClass): RoomMember | null => {
    const targetRoomMember = targetRoom.getMember(userId);

    if (targetRoomMember) return targetRoomMember;

    const knownProfile = context.userProfilesStore.getOnlyKnownProfile(userId);

    if (knownProfile) {
        return createMemberFromProfile(userId, knownProfile);
    }

    return null;
};

/**
 * Hook to get the permalink member
 *
 * @param type - Permalink type
 * @param parseResult - Permalink parse result
 * @param targetRoom - Permalink target room {@link ./usePermalinkTargetRoom.ts}
 * @param event - Permalink event
 * @returns The permalink member:
 *          - The room member for a user mention
 *          - The sender for a permalink to an event in the same room
 *          - Null in other cases or the user cannot be loaded.
 */
export const usePermalinkMember = (
    type: PillType | null,
    parseResult: PermalinkParts | null,
    targetRoom: Room | null,
    event: MatrixEvent | null,
): RoomMember | null => {
    const context = useContext(SDKContext);
    // User mentions and permalinks to events in the same room require to know the user.
    // If it cannot be initially determined, it will be looked up later by a memo hook.
    const shouldLookUpUser = type && [PillType.UserMention, PillType.EventInSameRoom].includes(type);
    const userId = determineUserId(type, parseResult, event);
    const userInRoom = shouldLookUpUser && userId && targetRoom ? determineMember(userId, targetRoom, context) : null;
    const [member, setMember] = useState<RoomMember | null>(userInRoom);

    useEffect(() => {
        // haven apps-framework patch: a room member with no display name or avatar of its own (some
        // bridges, left members) is looked up too, keeping the bare member until a profile turns up
        if (!shouldLookUpUser || !userId || (member && !isBareMember(member))) {
            // nothing to do here
            return;
        }

        const doProfileLookup = async (): Promise<void> => {
            const fetchedProfile = await context.userProfilesStore.fetchOnlyKnownProfile(userId);

            // haven apps-framework patch: an empty profile would only swap one bare member for
            // another and re-run this effect, so it falls through to the global lookup instead
            if (fetchedProfile && (fetchedProfile.displayname || fetchedProfile.avatar_url)) {
                const newMember = createMemberFromProfile(userId, fetchedProfile);
                setMember(newMember);
                return;
            }

            // haven apps-framework patch: fetchOnlyKnownProfile only answers for users we share a
            // room with, so anyone else (e.g. a bridged account replied to from another room) kept
            // a raw MXID pill. Fall back to their global profile - the same cached lookup Social and
            // the user info panel use.
            const client = context.client;
            if (!client) return;
            const liveProfile = await fetchUserProfile(client, userId);
            if (liveProfile.displayName || liveProfile.avatarUrl) {
                setMember(
                    createMemberFromProfile(userId, {
                        displayname: liveProfile.displayName,
                        avatar_url: liveProfile.avatarUrl,
                    }),
                );
            }
        };

        void doProfileLookup();
    }, [context, member, shouldLookUpUser, targetRoom, userId]);

    return member;
};
