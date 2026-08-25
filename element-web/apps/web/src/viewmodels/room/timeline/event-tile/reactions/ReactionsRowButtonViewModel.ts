/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { EventType, type MatrixClient, type MatrixEvent, type Relations, RelationType } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type ReactionsRowButtonViewSnapshot,
    type ReactionsRowButtonViewModel as ReactionsRowButtonViewModelInterface,
} from "@element-hq/web-shared-components";

import { mediaFromMxc } from "../../../../../customisations/Media";
import { _t } from "../../../../../languageHandler";
import { formatList } from "../../../../../utils/FormattingUtils";
import dis from "../../../../../dispatcher/dispatcher";
import Modal from "../../../../../Modal";
import ReactionsDialog from "../../../../../components/views/dialogs/ReactionsDialog";
import { ReactionsRowButtonTooltipViewModel } from "./ReactionsRowButtonTooltipViewModel";
import { REACTION_SHORTCODE_KEY } from "./reactionShortcode";

export interface ReactionsRowButtonViewModelProps {
    /**
     * The Matrix client instance.
     */
    client: MatrixClient;
    /**
     * The event we're displaying reactions for.
     */
    mxEvent: MatrixEvent;
    /**
     * The reaction content / key / emoji.
     */
    content: string;
    /**
     * The count of votes for this key.
     */
    count: number;
    /**
     * The CSS class name.
     */
    className?: string;
    /**
     * A list of Matrix reaction events for this key.
     */
    reactionEvents: MatrixEvent[];
    /**
     * A possible Matrix event if the current user has voted for this type.
     */
    myReactionEvent?: MatrixEvent;
    /**
     * Whether to prevent quick-reactions by clicking on this reaction.
     */
    disabled?: boolean;
    /**
     * Whether to render custom image reactions.
     */
    customReactionImagesEnabled?: boolean;
    /**
     * Haven: the full Relations for `mxEvent` - needed to open ReactionsDialog (see
     * onContextMenu) with the rest of the event's reaction groups, not just this button's own.
     */
    reactions?: Relations | null;
}

export class ReactionsRowButtonViewModel
    extends BaseViewModel<ReactionsRowButtonViewSnapshot, ReactionsRowButtonViewModelProps>
    implements ReactionsRowButtonViewModelInterface
{
    private readonly tooltipVm: ReactionsRowButtonTooltipViewModel;
    private static readonly getAriaLabel = (snapshot: ReactionsRowButtonViewSnapshot): string | undefined =>
        (snapshot as ReactionsRowButtonViewSnapshot & { ariaLabel?: string }).ariaLabel;

    private static readonly computeSnapshot = (
        props: ReactionsRowButtonViewModelProps,
        tooltipVm: ReactionsRowButtonTooltipViewModel,
    ): ReactionsRowButtonViewSnapshot => {
        const {
            client,
            mxEvent,
            content,
            count,
            className,
            reactionEvents,
            myReactionEvent,
            disabled,
            customReactionImagesEnabled,
        } = props;

        const room = client.getRoom(mxEvent.getRoomId());
        let ariaLabel: string | undefined;
        let customReactionName: string | undefined;

        if (room) {
            const senders: string[] = [];
            for (const reactionEvent of reactionEvents) {
                const member = room.getMember(reactionEvent.getSender()!);
                senders.push(member?.name || reactionEvent.getSender()!);
                // Haven: same fix as ReactionsRowButtonTooltipViewModel's own identical loop - keep
                // the first reactor's shortcode rather than letting a later reactor whose event
                // lacks the metadata clobber one already found.
                customReactionName ||=
                    (customReactionImagesEnabled && REACTION_SHORTCODE_KEY.findIn(reactionEvent.getContent())) ||
                    undefined;
            }

            const reactors = formatList(senders, 6);
            if (content) {
                ariaLabel = _t("timeline|reactions|label", {
                    reactors,
                    content: customReactionName || content,
                });
            } else {
                ariaLabel = reactors;
            }
        }

        let imageSrc: string | undefined;
        let imageAlt: string | undefined;
        if (customReactionImagesEnabled && content.startsWith("mxc://")) {
            const resolved = mediaFromMxc(content).srcHttp;
            if (resolved) {
                imageSrc = resolved;
                imageAlt = customReactionName || _t("timeline|reactions|custom_reaction_fallback_label");
            }
        }

        const snapshot = {
            content,
            count,
            className,
            ariaLabel,
            isSelected: !!myReactionEvent,
            isDisabled: !!disabled,
            imageSrc,
            imageAlt,
            tooltipVm,
        };

        return snapshot;
    };

    public constructor(props: ReactionsRowButtonViewModelProps) {
        const tooltipVm = new ReactionsRowButtonTooltipViewModel({
            client: props.client,
            mxEvent: props.mxEvent,
            content: props.content,
            reactionEvents: props.reactionEvents,
            customReactionImagesEnabled: props.customReactionImagesEnabled,
        });
        super(props, ReactionsRowButtonViewModel.computeSnapshot(props, tooltipVm));
        this.tooltipVm = tooltipVm;
        this.disposables.track(tooltipVm);
    }

    private setSnapshot(nextSnapshot: ReactionsRowButtonViewSnapshot): void {
        const currentSnapshot = this.snapshot.current;

        if (
            nextSnapshot.content === currentSnapshot.content &&
            nextSnapshot.count === currentSnapshot.count &&
            ReactionsRowButtonViewModel.getAriaLabel(nextSnapshot) ===
                ReactionsRowButtonViewModel.getAriaLabel(currentSnapshot) &&
            nextSnapshot.isSelected === currentSnapshot.isSelected &&
            nextSnapshot.isDisabled === currentSnapshot.isDisabled &&
            nextSnapshot.imageSrc === currentSnapshot.imageSrc &&
            nextSnapshot.imageAlt === currentSnapshot.imageAlt
        ) {
            return;
        }

        this.snapshot.set(nextSnapshot);
    }

    public setReactionData(
        content: string,
        reactionEvents: MatrixEvent[],
        customReactionImagesEnabled?: boolean,
    ): void {
        this.props = { ...this.props, content, reactionEvents, customReactionImagesEnabled };

        this.tooltipVm.setProps({ content, reactionEvents, customReactionImagesEnabled });
        this.setSnapshot(ReactionsRowButtonViewModel.computeSnapshot(this.props, this.tooltipVm));
    }

    public setCount(count: number): void {
        this.props = { ...this.props, count };
        this.snapshot.merge({ count });
    }

    public setMyReactionEvent(myReactionEvent?: MatrixEvent): void {
        this.props = { ...this.props, myReactionEvent };
        this.snapshot.merge({ isSelected: !!myReactionEvent });
    }

    public setDisabled(disabled?: boolean): void {
        this.props = { ...this.props, disabled };
        this.snapshot.merge({ isDisabled: !!disabled });
    }

    public setReactions(reactions?: Relations | null): void {
        this.props = { ...this.props, reactions };
    }

    /** Haven: right-clicking a reaction pill opens the same modal as the "..." menu's own
     *  "Reactions" option, pre-selected to this button's own reaction group - see
     *  ReactionsDialog.tsx's own doc. No-op if this button's Relations weren't threaded through
     *  (shouldn't happen via ReactionsRowAdapter, which always passes them). */
    public onContextMenu = (): void => {
        const { mxEvent, content, reactions } = this.props;
        if (!reactions) return;
        Modal.createDialog(ReactionsDialog, { mxEvent, reactions, initialContent: content }, "mx_ReactionsDialog_wrapper");
    };

    public onClick = (): void => {
        const { client, mxEvent, myReactionEvent, content, disabled } = this.props;
        if (disabled) return;

        if (myReactionEvent) {
            void client.redactEvent(mxEvent.getRoomId()!, myReactionEvent.getId()!);
            return;
        }

        void client.sendEvent(mxEvent.getRoomId()!, EventType.Reaction, {
            "m.relates_to": {
                rel_type: RelationType.Annotation,
                event_id: mxEvent.getId()!,
                key: content,
            },
        });
        dis.dispatch({ action: "message_sent" });
    };
}
