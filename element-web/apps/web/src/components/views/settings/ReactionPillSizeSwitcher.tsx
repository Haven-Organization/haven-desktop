/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Field, Label, RadioControl, Root } from "@vector-im/compound-web";
import { ReactionsRowButtonView, useMockedViewModel } from "@element-hq/web-shared-components";

import { SettingsSubsection } from "./shared/SettingsSubsection";
import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { useSettingValue } from "../../../hooks/useSettings";
import { ReactionPillSize } from "../../../settings/enums/ReactionPillSize";

// A small self-contained "custom pack emoji" placeholder for the preview below - an inline SVG
// data URI rather than a bundled asset, so this doesn't depend on any real emoji pack existing.
// A saturated fill plus a dark outline stroke keeps this readable against both a light and dark
// theme's own pill background, rather than a single flat fill color that can wash out on one of
// the two (confirmed live: a plain orange star was hard to make out at a glance either way).
const CUSTOM_EMOJI_PREVIEW_SRC =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
            // Literal "#" here, not "%23" - encodeURIComponent below does that encoding itself;
            // pre-encoding it here as well double-encodes to "%2523", which decodes back to the
            // literal string "%232BAE86" rather than a real color, silently making every shape
            // fall back to SVG's own default fill (solid black) - confirmed live.
            '<circle cx="12" cy="12" r="10" fill="#2BAE86" stroke="#0F172A" stroke-width="1.5"/>' +
            '<path fill="#ffffff" d="M12 5.5l1.8 3.9 4.3.5-3.2 3 .8 4.3-3.7-2-3.7 2 .8-4.3-3.2-3 4.3-.5z"/>' +
            "</svg>",
    );

/**
 * Haven: a section to switch between reaction pill sizes, styled the same way as
 * LayoutSwitcher's own layout selector (bordered radio tiles, each with a live preview) - laid
 * out side by side rather than stacked, since there are only two options here and both previews
 * are much shorter than a full message tile.
 */
export function ReactionPillSizeSwitcher(): JSX.Element {
    return (
        <SettingsSubsection heading={_t("settings|appearance|reaction_pill_size")} legacy={false}>
            <Root
                className="mx_ReactionPillSizeSwitcher_selector"
                onChange={async (evt) => {
                    const newSize = new FormData(evt.currentTarget).get("reactionPillSize") as ReactionPillSize;
                    await SettingsStore.setValue("Haven.reactionPillSize", null, SettingLevel.DEVICE, newSize);
                }}
            >
                <ReactionPillSizeRadio
                    size={ReactionPillSize.Normal}
                    label={_t("settings|appearance|reaction_pill_size_normal")}
                />
                <ReactionPillSizeRadio
                    size={ReactionPillSize.Large}
                    label={_t("settings|appearance|reaction_pill_size_large")}
                />
            </Root>
        </SettingsSubsection>
    );
}

interface ReactionPillSizeRadioProps {
    size: ReactionPillSize;
    label: string;
}

function ReactionPillSizeRadio({ size, label }: ReactionPillSizeRadioProps): JSX.Element {
    const currentSize = useSettingValue("Haven.reactionPillSize");

    return (
        <Field name="reactionPillSize" className="mx_ReactionPillSizeSwitcher_tile">
            <Label aria-label={label}>
                <div className="mx_ReactionPillSizeSwitcher_tile_inline">
                    <RadioControl name="reactionPillSize" value={size} defaultChecked={currentSize === size} />
                    <span>{label}</span>
                </div>
                <hr className="mx_ReactionPillSizeSwitcher_tile_separator" />
                <ReactionPillSizePreview size={size} />
            </Label>
        </Field>
    );
}

/**
 * A static, non-interactive preview of a message with a stock emoji, a custom pack emoji, and a
 * freeform-text reaction on it, rendered at the given size.
 *
 * Explicitly sets the --haven-reaction-pill-* variables itself (rather than relying on the real
 * mx_MatrixChat_reactionPillSizeNormal class, which is applied way up at the app root and reflects
 * whatever the setting is *currently* set to) - otherwise both preview tiles would silently render
 * at the same (wrong) size whenever the real setting already happens to match one of them.
 */
function ReactionPillSizePreview({ size }: { size: ReactionPillSize }): JSX.Element {
    const isNormal = size === ReactionPillSize.Normal;
    const style = {
        "--haven-reaction-pill-line-height": isNormal
            ? "var(--cpd-font-size-heading-sm)"
            : "var(--cpd-font-size-heading-md)",
        "--haven-reaction-pill-image-size": isNormal ? "16px" : "22px",
        "--haven-reaction-pill-emoji-font-size": isNormal
            ? "var(--cpd-font-size-body-md)"
            : "var(--cpd-font-size-heading-sm)",
    } as React.CSSProperties;

    return (
        <div className="mx_ReactionPillSizeSwitcher_preview" style={style}>
            <div className="mx_ReactionPillSizeSwitcher_preview_message">{_t("common|preview_message")}</div>
            <div className="mx_ReactionPillSizeSwitcher_preview_reactions">
                <PreviewReactionButton content="👍" count={3} isEmoji />
                <PreviewReactionButton imageSrc={CUSTOM_EMOJI_PREVIEW_SRC} imageAlt=":haven:" count={1} />
                <PreviewReactionButton content="nice" count={2} />
            </div>
        </div>
    );
}

interface PreviewReactionButtonProps {
    content?: string;
    imageSrc?: string;
    imageAlt?: string;
    count: number;
    isEmoji?: boolean;
}

/**
 * Renders a real ReactionsRowButtonView with a static mock view model - the same approach this
 * component's own Storybook stories use (see ReactionsRowButton.stories.tsx) - rather than
 * reimplementing its markup/CSS classes by hand, so this preview can never silently drift from
 * what a real reaction pill actually looks like. Passing no tooltipFormattedSenders keeps the
 * tooltip view's own early-return path (see ReactionsRowButtonTooltipView.tsx) from ever
 * initialising any floating-ui/hover behaviour at all - exactly what a static preview wants.
 */
function PreviewReactionButton({ content, imageSrc, imageAlt, count, isEmoji }: PreviewReactionButtonProps): JSX.Element {
    const tooltipVm = useMockedViewModel({ formattedSenders: undefined }, {});
    const vm = useMockedViewModel(
        { content, imageSrc, imageAlt, count, isSelected: false, isEmoji: !!isEmoji, tooltipVm },
        { onClick: () => {} },
    );
    return <ReactionsRowButtonView vm={vm} />;
}
