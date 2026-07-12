/*
 * Social Overlay — SocialProfileButton
 *
 * Shown in the stock member RightPanel (see UserInfoHeaderView.tsx) when the user being viewed has
 * a validly-formatted org.matrix.msc4501.social.profile_room_id linked — clicking it takes you to
 * their Social profile, the same place a matrix.to link to that room would (see MSC4501), without
 * ever showing the raw room in the regular timeline.
 *
 * The RightPanel can be open from outside Social entirely (a normal room's member list), so this
 * can't just call into SocialHomeView's own navigation state directly — it dispatches
 * SOCIAL_HOME_ACTION to get into Social first, handing off the userId via pendingViewUser.ts (see
 * there for why a dispatch payload alone can't do this).
 */

import React, { type JSX, useEffect, useState } from "react";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { getProfileRoomLink, PROFILE_ROOM_ID_PATTERN } from "../utils/social-actions";
import { setPendingViewUserId } from "../utils/pendingViewUser";
import { SOCIAL_HOME_ACTION } from "../homeAction";
import socialIcon from "../assets/social-icon.png";
import { isAppEnabled } from "../../framework/config";

interface Props {
    userId: string;
}

export function SocialProfileButton({ userId }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [profileRoomId, setProfileRoomId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setProfileRoomId(null);
        void getProfileRoomLink(client, userId).then((id) => {
            if (!cancelled) setProfileRoomId(id);
        });
        return () => {
            cancelled = true;
        };
    }, [client, userId]);

    // The RightPanel this renders in has nothing to do with Social's own enabled state - it's the
    // stock member panel, reachable from any room regardless of which Haven apps are on. Dispatching
    // SOCIAL_HOME_ACTION with Social disabled would try to navigate into a space/app that isn't
    // there, so this needs its own isAppEnabled check rather than relying on some other Social
    // component further down the line to catch it.
    if (!isAppEnabled("social")) return null;

    if (!profileRoomId || !PROFILE_ROOM_ID_PATTERN.test(profileRoomId)) return null;

    return (
        <button
            className="social_ProfileLinkButton"
            onClick={() => {
                setPendingViewUserId(userId);
                // sync: see the comment on handleMetaSpaceClickCapture in SpacePanel.tsx for why
                // this needs to beat any other pending navigation dispatched around the same time.
                defaultDispatcher.dispatch({ action: SOCIAL_HOME_ACTION }, true);
            }}
        >
            <img src={socialIcon} alt="" className="social_ProfileLinkButton_icon" />
            <span>View Profile</span>
        </button>
    );
}
