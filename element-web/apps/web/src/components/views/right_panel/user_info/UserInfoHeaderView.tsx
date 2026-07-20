/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type User, type RoomMember } from "matrix-js-sdk/src/matrix";
import { Heading, Tooltip, Text } from "@vector-im/compound-web";
import { Flex, StatusTextView } from "@element-hq/web-shared-components";

import { useUserfoHeaderViewModel } from "../../../viewmodels/right_panel/user_info/UserInfoHeaderViewModel";
import MemberAvatar from "../../avatars/MemberAvatar";
import { Container, type Member, type IDevice } from "../UserInfo";
import PresenceLabel from "../../rooms/PresenceLabel";
import CopyableText from "../../elements/CopyableText";
import { UserInfoHeaderVerificationView } from "./UserInfoHeaderVerificationView";
// haven apps-framework patch
import { SocialProfileButton } from "../../../../../../../../src/apps/social/components/SocialProfileButton";
import { ExternalHandleBadge } from "../../../../../../../../src/apps/social/components/ExternalHandleBadge";
import { useUserBanner } from "../../../../../../../../src/apps/social/utils/useUserBanner";
import { useLiveUserProfile } from "../../../../../../../../src/apps/social/utils/liveUserProfile";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { useUserStatus } from "../../../../hooks/useUserStatus";

export interface UserInfoHeaderViewProps {
    member: Member;
    roomId?: string;
    devices: IDevice[];
    hideVerificationSection: boolean;
}

export const UserInfoHeaderView: React.FC<UserInfoHeaderViewProps> = ({
    member,
    devices,
    roomId,
    hideVerificationSection,
}) => {
    const vm = useUserfoHeaderViewModel({ member, roomId });
    const avatarUrl = (member as User).avatarUrl;
    const displayName = (member as RoomMember).rawDisplayName;
    // haven apps-framework patch: banner from this user's linked MSC4501 profile room, if any -
    // see useUserBanner.ts. null for the majority of users with no linked profile room, in which
    // case nothing renders and this panel looks exactly as it did before.
    const client = useMatrixClientContext();
    const bannerUrl = useUserBanner(client, member.userId);
    // haven apps-framework patch: MSC4503 external handle (e.g. a linked Fediverse handle), shown
    // right under the MXID below - see ExternalHandleBadge.tsx.
    const liveProfile = useLiveUserProfile(client, member.userId);
    const userStatus = useUserStatus(member.userId);

    let presenceLabel: JSX.Element | undefined;

    if (vm.showPresence) {
        presenceLabel = (
            <PresenceLabel
                activeAgo={vm.precenseInfo.lastActiveAgo}
                currentlyActive={vm.precenseInfo.currentlyActive}
                presenceState={vm.precenseInfo.state}
                className="mx_UserInfo_profileStatus"
                coloured
            />
        );
    }

    return (
        <React.Fragment>
            {/* haven apps-framework patch: only rendered once a banner resolves - see
                useUserBanner.ts. Sits directly before mx_UserInfo_avatar so the sibling-selector
                overlap rule in _UserInfo.pcss (mirroring RoomSummaryCardView's own banner/avatar
                overlap) can apply. */}
            {bannerUrl && <img src={bannerUrl} className="social_UserInfoBanner" alt="" aria-hidden />}
            <div className="mx_UserInfo_avatar">
                <div className="mx_UserInfo_avatar_transition">
                    <div className="mx_UserInfo_avatar_transition_child">
                        <MemberAvatar
                            key={member.userId} // to instantly blank the avatar when UserInfo changes members
                            member={member as RoomMember}
                            size="120px"
                            resizeMethod="scale"
                            fallbackUserId={member.userId}
                            onClick={vm.onMemberAvatarClick}
                            urls={avatarUrl ? [avatarUrl] : undefined}
                        />
                    </div>
                </div>
            </div>

            <Container className="mx_UserInfo_header">
                <Flex direction="column" align="center" className="mx_UserInfo_profile">
                    <Heading size="sm" weight="semibold" as="h1" dir="auto">
                        <Flex className="mx_UserInfo_profile_name" direction="row-reverse" align="center">
                            {displayName}
                        </Flex>
                    </Heading>
                    {userStatus && <StatusTextView status={userStatus} />}
                    {presenceLabel}
                    {vm.timezoneInfo && (
                        <Tooltip label={vm.timezoneInfo?.timezone ?? ""}>
                            <Flex align="center" className="mx_UserInfo_timezone">
                                <Text size="sm" weight="regular">
                                    {vm.timezoneInfo?.friendly ?? ""}
                                </Text>
                            </Flex>
                        </Tooltip>
                    )}
                    <Text size="sm" weight="semibold" className="mx_UserInfo_profile_mxid">
                        <CopyableText getTextToCopy={() => vm.userIdentifier} border={false}>
                            {vm.userIdentifier}
                        </CopyableText>
                    </Text>
                    {/* haven apps-framework patch: only renders once a validly-shaped MSC4503
                        external_handle resolves for this user - see ExternalHandleBadge.tsx */}
                    {liveProfile?.externalHandle && <ExternalHandleBadge externalHandle={liveProfile.externalHandle} />}
                </Flex>
                {!hideVerificationSection && <UserInfoHeaderVerificationView member={member} devices={devices} />}
                {/* haven apps-framework patch: only renders once a validly-formatted MSC4501
                    profile_room_id resolves for this user — see SocialProfileButton.tsx */}
                <SocialProfileButton userId={member.userId} />
            </Container>
        </React.Fragment>
    );
};
