/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, afterEach, expect } from "vitest";

import { SpaceSwitcherMenu } from "./SpaceSwitcherMenu";
import { defaultSnapshot, MockedViewModel } from "../test-utils";

describe("<SpaceSwitcherMenu />", () => {
    const renderSpaceIcon = (spaceId: string) => <svg data-testid={`icon-${spaceId}`} />;

    afterEach(() => {
        vi.clearAllMocks();
    });

    const snapshot = {
        ...defaultSnapshot,
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
        ],
    };

    it("should match snapshot", () => {
        const vm = new MockedViewModel(snapshot);
        const { asFragment } = render(
            <SpaceSwitcherMenu vm={vm} title="Home" renderSpaceIcon={renderSpaceIcon} />,
        );

        expect(asFragment()).toMatchSnapshot();
    });

    it("should display the title as the trigger's own label", () => {
        const vm = new MockedViewModel(snapshot);
        render(<SpaceSwitcherMenu vm={vm} title="Home" renderSpaceIcon={renderSpaceIcon} />);

        expect(screen.getByRole("button", { name: "Switch space" })).toHaveTextContent("Home");
    });

    it("should list every space when opened", async () => {
        const user = userEvent.setup();
        const vm = new MockedViewModel(snapshot);
        render(<SpaceSwitcherMenu vm={vm} title="Home" renderSpaceIcon={renderSpaceIcon} />);

        await user.click(screen.getByRole("button", { name: "Switch space" }));

        expect(screen.getByRole("menuitem", { name: "Home" })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: "My Space" })).toBeInTheDocument();
    });

    it("should call switchToSpace with the clicked space's id", async () => {
        const user = userEvent.setup();
        const vm = new MockedViewModel(snapshot);
        render(<SpaceSwitcherMenu vm={vm} title="Home" renderSpaceIcon={renderSpaceIcon} />);

        await user.click(screen.getByRole("button", { name: "Switch space" }));
        await user.click(screen.getByRole("menuitem", { name: "My Space" }));

        expect(vm.switchToSpace).toHaveBeenCalledWith("!space1:example.org");
    });

    it("should show a notification badge for a space with one, and none for a space without", async () => {
        const user = userEvent.setup();
        const vm = new MockedViewModel(snapshot);
        render(<SpaceSwitcherMenu vm={vm} title="Home" renderSpaceIcon={renderSpaceIcon} />);

        await user.click(screen.getByRole("button", { name: "Switch space" }));

        const mySpaceItem = screen.getByRole("menuitem", { name: "My Space" });
        expect(within(mySpaceItem).getByTestId("notification-decoration")).toBeInTheDocument();

        const homeItem = screen.getByRole("menuitem", { name: "Home" });
        expect(within(homeItem).queryByTestId("notification-decoration")).not.toBeInTheDocument();
    });
});
