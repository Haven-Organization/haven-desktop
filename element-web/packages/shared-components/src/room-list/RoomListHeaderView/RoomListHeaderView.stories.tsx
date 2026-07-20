/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    RoomListHeaderView,
    type RoomListHeaderViewActions,
    type RoomListHeaderViewSnapshot,
} from "./RoomListHeaderView";
import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";
import { defaultSnapshot } from "./default-snapshot";

type RoomListHeaderProps = RoomListHeaderViewSnapshot & RoomListHeaderViewActions;

const renderSpaceIcon = (spaceId: string): JSX.Element => (
    <div
        aria-hidden
        style={{ width: 20, height: 20, borderRadius: 4, background: "var(--cpd-color-icon-tertiary)" }}
        data-space-id={spaceId}
    />
);

const RoomListHeaderViewWrapperImpl = ({
    createChatRoom,
    createRoom,
    createVideoRoom,
    openSpaceHome,
    openSpaceSettings,
    inviteInSpace,
    openSpacePreferences,
    createSection,
    collapseOrExpandSections,
    closeSectionReleaseAnnouncement,
    switchToSpace,
    ...rest
}: RoomListHeaderProps): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        createChatRoom,
        createRoom,
        createVideoRoom,
        openSpaceHome,
        openSpaceSettings,
        inviteInSpace,
        openSpacePreferences,
        createSection,
        collapseOrExpandSections,
        closeSectionReleaseAnnouncement,
        switchToSpace,
    });
    return <RoomListHeaderView vm={vm} renderSpaceIcon={renderSpaceIcon} />;
};
const RoomListHeaderViewWrapper = withViewDocs(RoomListHeaderViewWrapperImpl, RoomListHeaderView);

const meta = {
    title: "Room List/RoomListHeaderView",
    component: RoomListHeaderViewWrapper,
    tags: ["autodocs"],
    args: {
        ...defaultSnapshot,
        createChatRoom: fn(),
        createRoom: fn(),
        createVideoRoom: fn(),
        openSpaceHome: fn(),
        openSpaceSettings: fn(),
        inviteInSpace: fn(),
        openSpacePreferences: fn(),
        createSection: fn(),
        collapseOrExpandSections: fn(),
        closeSectionReleaseAnnouncement: fn(),
        switchToSpace: fn(),
    },
    parameters: {
        design: {
            type: "figma",
            url: "https://www.figma.com/design/vlmt46QDdE4dgXDiyBJXqp/ER-33-Left-Panel?node-id=2925-19173",
        },
    },
} satisfies Meta<typeof RoomListHeaderViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSpaceMenu: Story = {
    args: {
        displaySpaceMenu: false,
    },
};

export const LongTitle: Story = {
    decorators: [
        (Story) => (
            <div style={{ width: "200px" }}>
                <Story />
            </div>
        ),
    ],
    args: {
        title: "Loooooooooooooooooooooooooooooooooooooong title",
    },
};

export const CollapseSections: Story = {
    args: {
        collapseSections: "collapse",
    },
};

export const ExpandSections: Story = {
    args: {
        collapseSections: "expand",
    },
};

export const DisplaySectionReleaseAnnouncement: Story = {
    decorators: [
        (Story) => (
            <div style={{ width: "300px" }}>
                <Story />
            </div>
        ),
    ],
    args: {
        displaySectionReleaseAnnouncement: true,
    },
    parameters: {
        a11y: {
            config: {
                rules: [
                    {
                        // compound-web's ReleaseAnnouncement renders its header as <h3>,
                        // which jumps from RoomListHeaderView's <h1> ("Rooms").
                        id: "heading-order",
                        enabled: false,
                    },
                ],
            },
        },
    },
};

export const SectionsDisabled: Story = {
    args: {
        areSectionsEnabled: false,
    },
};

export const SpaceSwitcher: Story = {
    args: {
        showSpaceSwitcher: true,
        spaceSwitcherItems: [
            { id: "home-space", name: "Home", isActive: true },
            {
                id: "!space1:example.org",
                name: "My Space",
                isActive: false,
                notification: {
                    hasAnyNotificationOrActivity: true,
                    isUnsentMessage: false,
                    isMention: false,
                    isNotification: true,
                    isActivityNotification: false,
                    hasUnreadCount: true,
                    count: 3,
                    invited: false,
                    muted: false,
                },
            },
            { id: "!space2:example.org", name: "Another Space", isActive: false },
        ],
    },
};

export const SpaceSwitcherManySpaces: Story = {
    args: {
        showSpaceSwitcher: true,
        spaceSwitcherItems: [
            { id: "home-space", name: "Home", isActive: true },
            ...Array.from({ length: 20 }, (_, i) => ({
                id: `!space${i}:example.org`,
                name: `Space ${i + 1}`,
                isActive: false,
            })),
        ],
    },
};

export const NoComposeMenu: Story = {
    args: {
        canCreateRoom: false,
        canCreateVideoRoom: false,
        areSectionsEnabled: false,
    },
};
