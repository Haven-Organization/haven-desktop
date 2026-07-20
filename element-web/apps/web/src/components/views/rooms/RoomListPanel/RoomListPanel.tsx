/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useCallback, useContext, type ReactElement } from "react";
import {
    HomeSolidIcon,
    FavouriteSolidIcon,
    UserProfileSolidIcon,
    RoomIcon,
    VideoCallSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { Flex, RoomListHeaderView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../../settings/UIFeature";
import { RoomListSearch } from "./RoomListSearch";
import { RoomListView } from "./RoomListView";
import { _t } from "../../../../languageHandler";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import { Landmark, LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { type IState as IRovingTabIndexState } from "../../../../accessibility/RovingTabIndex";
import { RoomListHeaderViewModel } from "../../../../viewmodels/room-list/RoomListHeaderViewModel";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { isMetaSpace, MetaSpace } from "../../../../stores/spaces";
import RoomAvatar from "../../avatars/RoomAvatar";

/**
 * Haven: icon for each meta-space in the space-switcher menu (see renderSpaceIcon below) - mirrors
 * the icon each one gets in the spaces bar itself (see SpacePanel.tsx's metaSpaceComponentMap).
 */
const metaSpaceIcons: Record<MetaSpace, ReactElement> = {
    [MetaSpace.Home]: <HomeSolidIcon />,
    [MetaSpace.Favourites]: <FavouriteSolidIcon />,
    [MetaSpace.People]: <UserProfileSolidIcon />,
    [MetaSpace.Orphans]: <RoomIcon />,
    [MetaSpace.VideoRooms]: <VideoCallSolidIcon />,
};

type RoomListPanelProps = {
    /**
     * Current active space
     * See {@link RoomListSearch}
     */
    activeSpace: string;
    /**
     * Haven apps-framework patch: callback ref for a portal target rendered next to the search
     * bar, used to relocate the top-left UserMenu here when the spaces bar is hidden (see
     * SpacePanel.tsx).
     */
    userMenuPortalRef?: (node: HTMLDivElement | null) => void;
};

/**
 * The panel of the room list
 */
export const RoomListPanel: React.FC<RoomListPanelProps> = ({ activeSpace, userMenuPortalRef }) => {
    const sdkContext = useContext(SDKContext);
    const displayRoomSearch = shouldShowComponent(UIComponent.FilterContainer);
    const [focusedElement, setFocusedElement] = useState<Element | null>(null);

    const onFocus = useCallback((ev: React.FocusEvent): void => {
        setFocusedElement(ev.target as Element);
    }, []);

    const onBlur = useCallback((): void => {
        setFocusedElement(null);
    }, []);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent, state?: IRovingTabIndexState): void => {
            if (!focusedElement) return;
            const navAction = getKeyBindingsManager().getNavigationAction(ev);
            if (navAction === KeyBindingAction.PreviousLandmark || navAction === KeyBindingAction.NextLandmark) {
                ev.stopPropagation();
                ev.preventDefault();
                LandmarkNavigation.findAndFocusNextLandmark(
                    Landmark.ROOM_SEARCH,
                    navAction === KeyBindingAction.PreviousLandmark,
                );
            }
        },
        [focusedElement],
    );

    const matrixClient = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () => new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore }),
    );

    // Haven: renders the icon/avatar for a given space id in the switcher menu (shown when the
    // spaces bar is off - see RoomListHeaderView's own doc for why it needs this from the app
    // rather than rendering its own). Meta-spaces get a fixed icon (mirroring the spaces bar);
    // real spaces get their own square avatar, same as the spaces bar's own SpaceItem/SpaceButton.
    const renderSpaceIcon = useCallback(
        (spaceId: string): ReactElement => {
            if (isMetaSpace(spaceId)) return metaSpaceIcons[spaceId as MetaSpace];
            const room = matrixClient.getRoom(spaceId) ?? undefined;
            return <RoomAvatar size="20px" room={room} type="square" />;
        },
        [matrixClient],
    );

    return (
        <Flex
            as="nav"
            className="mx_RoomListPanel"
            direction="column"
            align="stretch"
            aria-label={_t("room_list|list_title")}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
        >
            {/* haven apps-framework patch: room icon/Apps button (portaled) and RoomListSearch
                (stock, its own already-a-flex-row wrapper - see .haven_RoomListPanel_topRow in
                apps-framework.scss) share one row instead of stacking as separate rows - this
                Flex's own direction="column" would otherwise put each direct child on its own
                line. */}
            <div className="haven_RoomListPanel_topRow">
                <div ref={userMenuPortalRef} className="haven_UserMenuPortalTarget" />
                {displayRoomSearch && <RoomListSearch activeSpace={activeSpace} />}
            </div>
            <RoomListHeaderView vm={vm} renderSpaceIcon={renderSpaceIcon} />
            <RoomListView />
        </Flex>
    );
};
