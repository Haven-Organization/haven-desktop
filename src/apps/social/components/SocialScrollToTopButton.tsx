/*
 * Social Overlay — SocialScrollToTopButton
 *
 * Same round button as stock's own JumpToBottomButton.tsx (same AccessibleButton, same
 * .mx_JumpToBottomButton_scrollDown class - so it looks and feels identical, no new CSS needed for
 * the button itself) - just pointed the other way. Stock's version sits bottom-right and scrolls
 * down to the live edge of a room's timeline, since new messages arrive at the bottom; Social's own
 * feed is newest-at-top, so the equivalent "back to the live edge" action is scrolling up instead,
 * hence the up-pointing chevron and top-right position (positioning is Social's own -
 * .social_ScrollToTopButton - since stock's own wrapper hardcodes bottom-right).
 */

import React, { type JSX } from "react";
import { ChevronUpIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";

interface Props {
    onClick: () => void;
}

export function SocialScrollToTopButton({ onClick }: Props): JSX.Element {
    return (
        <div className="social_ScrollToTopButton">
            <AccessibleButton
                className="mx_JumpToBottomButton_scrollDown"
                title="Scroll to top"
                onClick={onClick}
            >
                <ChevronUpIcon />
            </AccessibleButton>
        </div>
    );
}
