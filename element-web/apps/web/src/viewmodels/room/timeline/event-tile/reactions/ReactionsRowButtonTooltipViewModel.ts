/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type ReactionsRowButtonTooltipViewSnapshot,
    type ReactionsRowButtonTooltipViewModel as ReactionsRowButtonTooltipViewModelInterface,
} from "@element-hq/web-shared-components";

import { mediaFromMxc } from "../../../../../customisations/Media";
import { _t } from "../../../../../languageHandler";
import { formatList } from "../../../../../utils/FormattingUtils";
import { unicodeToShortcode } from "../../../../../HtmlUtils";
import { REACTION_SHORTCODE_KEY } from "./reactionShortcode";

export interface ReactionsRowButtonTooltipViewModelProps {
    /**
     * The Matrix client instance.
     */
    client: MatrixClient | null;
    /**
     * The event we're displaying reactions for.
     */
    mxEvent: MatrixEvent;
    /**
     * The reaction content / key / emoji.
     */
    content: string;
    /**
     * A list of Matrix reaction events for this key.
     */
    reactionEvents: MatrixEvent[];
    /**
     * Whether to render custom image reactions.
     */
    customReactionImagesEnabled?: boolean;
    /**
     * Haven: called when the tooltip popover itself is clicked - opens ReactionsDialog with this
     * reaction pre-selected. Supplied by ReactionsRowButtonViewModel, which owns the Relations
     * needed to actually open the dialog (see its own onContextMenu, which this mirrors).
     */
    onOpenDialog?: () => void;
}

/**
 * ViewModel for the reactions row button tooltip, providing the formatted sender list and caption.
 */
export class ReactionsRowButtonTooltipViewModel
    extends BaseViewModel<ReactionsRowButtonTooltipViewSnapshot, ReactionsRowButtonTooltipViewModelProps>
    implements ReactionsRowButtonTooltipViewModelInterface
{
    /**
     * Computes the snapshot for the reactions row button tooltip.
     * @param props - The view model properties
     * @returns The computed snapshot with formattedSenders, caption, and children
     */
    private static readonly computeSnapshot = (
        props: ReactionsRowButtonTooltipViewModelProps,
    ): ReactionsRowButtonTooltipViewSnapshot => {
        const { client, mxEvent, content, reactionEvents, customReactionImagesEnabled, onOpenDialog } = props;

        const room = client?.getRoom(mxEvent.getRoomId());

        // Haven: the large icon shown in the popover - same logic ReactionsRowButtonViewModel
        // uses for the pill's own icon, duplicated here rather than threaded through as a prop
        // since it depends on customReactionImagesEnabled/content which this view model already
        // has independently (matches this file's existing customReactionName duplication).
        let imageSrc: string | undefined;
        let imageAlt: string | undefined;

        if (room) {
            const senders: string[] = [];
            let customReactionName: string | undefined;

            for (const reactionEvent of reactionEvents) {
                const member = room.getMember(reactionEvent.getSender()!);
                const name = member?.name ?? reactionEvent.getSender()!;
                senders.push(name);
                // Haven: keep the first reactor's shortcode, don't let a later reactor whose own
                // event happens to lack the metadata (e.g. sent from a client that doesn't attach
                // it) clobber one already found - this was silently dropping the whole "reacted
                // with :name:" caption for any multi-reactor custom emoji where the LAST reactor's
                // event lacked it, even though an earlier one had it.
                customReactionName ||=
                    (customReactionImagesEnabled && REACTION_SHORTCODE_KEY.findIn(reactionEvent.getContent())) ||
                    undefined;
            }

            if (customReactionImagesEnabled && content.startsWith("mxc://")) {
                const resolved = mediaFromMxc(content).srcHttp;
                if (resolved) {
                    imageSrc = resolved;
                    imageAlt = customReactionName || _t("timeline|reactions|custom_reaction_fallback_label");
                }
            }

            const knownShortcode = unicodeToShortcode(content);
            const shortName = knownShortcode || customReactionName;
            const formattedSenders = formatList(senders, 6);
            // Haven: an `mxc://` reaction is never freeform text even when customReactionImagesEnabled
            // is off and it therefore failed to resolve into an actual imageSrc above - it's still a
            // custom pack reference, just not one this client is configured to render as an image.
            const isMxcContent = content.startsWith("mxc://");
            // Haven: a real emoji (known shortcode), a custom pack image, or an unresolved mxc://
            // reference all get the big icon slot. Anything else is a genuine freeform-text reaction
            // (e.g. "LOST") - there's no sensible icon-sized rendering of arbitrary text, so it gets
            // no icon at all, and its own caption is just the raw text itself, keeping the "reacted
            // with ..." line present for every reaction kind rather than only emoji/image ones.
            const hasEmojiIcon = !!imageSrc || !!knownShortcode || isMxcContent;
            const caption = shortName
                ? _t("timeline|reactions|tooltip_caption", { shortName })
                : imageSrc || isMxcContent
                  ? undefined
                  : _t("timeline|reactions|tooltip_caption", { shortName: content });

            return {
                formattedSenders,
                caption,
                content,
                hasEmojiIcon,
                imageSrc,
                imageAlt,
                onOpenDialog,
            };
        }

        return {
            formattedSenders: undefined,
            caption: undefined,
        };
    };

    public constructor(props: ReactionsRowButtonTooltipViewModelProps) {
        super(props, ReactionsRowButtonTooltipViewModel.computeSnapshot(props));
    }

    /**
     * Updates the properties of the view model and recomputes the snapshot.
     * @param newProps - Partial properties to update
     */
    public setProps(newProps: Partial<ReactionsRowButtonTooltipViewModelProps>): void {
        this.props = { ...this.props, ...newProps };
        const nextSnapshot = ReactionsRowButtonTooltipViewModel.computeSnapshot(this.props);
        const currentSnapshot = this.snapshot.current;

        if (
            nextSnapshot.formattedSenders === currentSnapshot.formattedSenders &&
            nextSnapshot.caption === currentSnapshot.caption &&
            nextSnapshot.content === currentSnapshot.content &&
            nextSnapshot.hasEmojiIcon === currentSnapshot.hasEmojiIcon &&
            nextSnapshot.imageSrc === currentSnapshot.imageSrc &&
            nextSnapshot.onOpenDialog === currentSnapshot.onOpenDialog
        ) {
            return;
        }

        this.snapshot.set(nextSnapshot);
    }
}
