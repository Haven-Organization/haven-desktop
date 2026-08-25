/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type MatrixEvent, type Relations, RelationsEvent } from "matrix-js-sdk/src/matrix";
import { uniqBy } from "lodash";
import classNames from "classnames";
import { SearchIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import BaseDialog from "./BaseDialog";
import FindPackDialog from "./FindPackDialog";
import ImageView from "../elements/ImageView";
import AccessibleButton from "../elements/AccessibleButton";
import MemberAvatar from "../avatars/MemberAvatar";
import { CardContext } from "../right_panel/context";
import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { mediaFromMxc } from "../../../customisations/Media";
import { unicodeToShortcode } from "../../../HtmlUtils";
import { getImageSourcePackRefs } from "../../../utils/imageSourcePacks";
import { REACTION_SHORTCODE_KEY } from "../../../viewmodels/room/timeline/event-tile/reactions/reactionShortcode";
import { getReactionGroups, type ReactionGroup } from "../rooms/EventTile/ReactionsRowAdapter";

interface IProps {
    mxEvent: MatrixEvent;
    reactions: Relations;
    /** Haven: pre-selects this reaction's own group in the left rail - set when opened via
     *  right-clicking a specific reaction pill (see ReactionsRowButtonViewModel's onContextMenu),
     *  left unset when opened via the "..." menu's own generic "Reactions" option. */
    initialContent?: string;
    onFinished(): void;
}

/** A reaction group's own display shortcode, e.g. ":laughing:" for a real unicode emoji, or a
 *  custom emoji's own com.beeper.reaction.shortcode metadata (already ":wrapped:" in colons at the
 *  source, same convention unicodeToShortcode itself uses) - undefined when neither is available
 *  (an mxc:// custom reaction sent by a client that never attached shortcode metadata). Mirrors
 *  ReactionsRowButtonTooltipViewModel's own identical logic - kept in sync deliberately since both
 *  are "what should this reaction be called" for the same underlying data. */
function reactionGroupShortName(group: ReactionGroup): string | undefined {
    const unicodeShortcode = unicodeToShortcode(group.content);
    if (unicodeShortcode) return unicodeShortcode;
    for (const event of group.events) {
        const shortcode = REACTION_SHORTCODE_KEY.findIn<string>(event.getContent());
        if (shortcode) return shortcode;
    }
    return undefined;
}

/** Haven: "view reactions" modal - opened from MessageContextMenu's own "Reactions" option (shown
 *  whenever the event has at least one reaction) and from right-clicking a reaction pill directly
 *  (see ReactionsRowButtonViewModel.onContextMenu, which passes initialContent). Modeled on Sable's
 *  own reactions modal (a left rail of reaction groups, a right pane listing who reacted with the
 *  selected group) - deliberately given a larger fixed minimum size than Sable's own version, which
 *  dynamically shrinks to fit its content and ends up cramped for anything but a handful of reactors. */
export default function ReactionsDialog({ mxEvent, reactions, initialContent, onFinished }: IProps): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const room = client.getRoom(mxEvent.getRoomId());
    const card = useContext(CardContext);

    const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>(() => getReactionGroups(reactions));
    // Dedupe by sender per Matrix spec, same as the timeline's own reaction pills (ReactionsRowAdapter) -
    // so the counts shown here always match what's already visible under the event.
    const dedupedGroups = useMemo<ReactionGroup[]>(
        () =>
            reactionGroups.map((group) => ({
                content: group.content,
                events: uniqBy(group.events, (event) => event.getSender()),
            })),
        [reactionGroups],
    );
    const [selectedContent, setSelectedContent] = useState<string | undefined>(
        () => initialContent ?? dedupedGroups[0]?.content,
    );

    useEffect(() => {
        const update = (): void => setReactionGroups(getReactionGroups(reactions));
        reactions.on(RelationsEvent.Add, update);
        reactions.on(RelationsEvent.Remove, update);
        reactions.on(RelationsEvent.Redaction, update);
        return () => {
            reactions.off(RelationsEvent.Add, update);
            reactions.off(RelationsEvent.Remove, update);
            reactions.off(RelationsEvent.Redaction, update);
        };
    }, [reactions]);

    // If the selected group's own last reaction just got redacted out from under us, fall back to
    // whatever group is now first rather than showing an empty right pane forever.
    useEffect(() => {
        if (!dedupedGroups.some((group) => group.content === selectedContent)) {
            setSelectedContent(dedupedGroups[0]?.content);
        }
    }, [dedupedGroups, selectedContent]);

    const selectedGroup = dedupedGroups.find((group) => group.content === selectedContent);
    const selectedEvents = selectedGroup?.events ?? [];

    const handleFindPack = useCallback((event: MatrixEvent) => {
        const packRef = getImageSourcePackRefs(event)[0];
        if (!packRef) return;
        Modal.createDialog(FindPackDialog, { packRef }, "mx_FindPackDialog_wrapper");
    }, []);

    const handleViewImage = useCallback(
        (src: string, name: string) => {
            // Haven: close this dialog first - otherwise it stays open, stacked on top of the
            // lightbox it just opened.
            onFinished();
            Modal.createDialog(ImageView, { src, name }, "mx_Dialog_lightbox", undefined, true);
        },
        [onFinished],
    );

    const handleViewUser = useCallback(
        (member: NonNullable<ViewUserPayload["member"]>) => {
            // Haven: close this dialog first - otherwise it stays open, stacked above the member
            // right panel it just opened.
            onFinished();
            dis.dispatch<ViewUserPayload>({ action: Action.ViewUser, member, push: card.isCard });
        },
        [card.isCard, onFinished],
    );

    const shortName = selectedGroup && reactionGroupShortName(selectedGroup);
    const title = shortName
        ? _t("timeline|reactions|dialog_title", { shortName })
        : _t("timeline|reactions|dialog_title_generic");

    const selectedIsCustomImage = selectedGroup?.content.startsWith("mxc://") ?? false;
    const selectedImageSrc = selectedIsCustomImage
        ? (mediaFromMxc(selectedGroup!.content).srcHttp ?? undefined)
        : undefined;
    const selectedIsRealEmoji = !selectedIsCustomImage && !!selectedGroup && !!unicodeToShortcode(selectedGroup.content);

    return (
        <BaseDialog
            className="mx_ReactionsDialog"
            aria-label={title}
            hasCancel
            onFinished={onFinished}
            fixedWidth={false}
        >
            <div className="mx_ReactionsDialog_body">
                <ul className="mx_ReactionsDialog_rail">
                    {dedupedGroups.map((group) => (
                        <ReactionsDialogRailItem
                            key={group.content}
                            group={group}
                            selected={group.content === selectedContent}
                            onSelect={() => setSelectedContent(group.content)}
                        />
                    ))}
                </ul>
                <div className="mx_ReactionsDialog_usersPane">
                    <div className="mx_ReactionsDialog_usersHeader">
                        {selectedIsCustomImage && selectedImageSrc ? (
                            <AccessibleButton
                                className="mx_ReactionsDialog_usersHeaderImageButton"
                                onClick={() => handleViewImage(selectedImageSrc, shortName ?? title)}
                                title={_t("action|view")}
                            >
                                <img
                                    className="mx_ReactionsDialog_usersHeaderImage"
                                    src={selectedImageSrc}
                                    alt={shortName ?? ""}
                                />
                            </AccessibleButton>
                        ) : (
                            <span
                                className={classNames("mx_ReactionsDialog_usersHeaderContent", {
                                    mx_ReactionsDialog_usersHeaderContent_emoji: selectedIsRealEmoji,
                                })}
                                aria-hidden="true"
                            >
                                {selectedGroup?.content}
                            </span>
                        )}
                        <span className="mx_ReactionsDialog_usersHeaderTitle">{title}</span>
                    </div>
                    <ul className="mx_ReactionsDialog_users">
                        {selectedEvents.map((event) => {
                            const sender = event.getSender()!;
                            const member = room?.getMember(sender) ?? null;
                            const hasPackRef = getImageSourcePackRefs(event).length > 0;
                            const name = member?.name ?? sender;
                            const avatarAndName = (
                                <>
                                    <MemberAvatar member={member} fallbackUserId={sender} size="32px" />
                                    <span className="mx_ReactionsDialog_userName">{name}</span>
                                </>
                            );
                            return (
                                <li key={sender} className="mx_ReactionsDialog_user">
                                    {member ? (
                                        <AccessibleButton
                                            className="mx_ReactionsDialog_userIdentity"
                                            onClick={() => handleViewUser(member)}
                                        >
                                            {avatarAndName}
                                        </AccessibleButton>
                                    ) : (
                                        <div className="mx_ReactionsDialog_userIdentity">{avatarAndName}</div>
                                    )}
                                    {hasPackRef && (
                                        <AccessibleButton
                                            className="mx_ReactionsDialog_findPack"
                                            onClick={() => handleFindPack(event)}
                                            title={_t("timeline|reactions|dialog_find_pack")}
                                        >
                                            <SearchIcon width="18px" height="18px" />
                                        </AccessibleButton>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </BaseDialog>
    );
}

function ReactionsDialogRailItem({
    group,
    selected,
    onSelect,
}: {
    group: ReactionGroup;
    selected: boolean;
    onSelect: () => void;
}): JSX.Element {
    const isCustomImage = group.content.startsWith("mxc://");
    const shortName = reactionGroupShortName(group);
    // Haven: a genuine unicode emoji (has a resolvable shortcode) gets a bigger glyph than a
    // freeform text reaction (an arbitrary word, which needs to stay small enough to have a real
    // chance of fitting the rail's fixed width on one line - see overflow-wrap below).
    const isRealEmoji = !isCustomImage && !!unicodeToShortcode(group.content);

    return (
        <li>
            <AccessibleButton
                className="mx_ReactionsDialog_railItem"
                aria-pressed={selected}
                onClick={onSelect}
                title={shortName}
            >
                {isCustomImage ? (
                    <img
                        className="mx_ReactionsDialog_railItemImage"
                        src={mediaFromMxc(group.content).srcHttp ?? undefined}
                        alt={shortName ?? ""}
                    />
                ) : (
                    <span
                        className={classNames("mx_ReactionsDialog_railItemContent", {
                            mx_ReactionsDialog_railItemContent_emoji: isRealEmoji,
                        })}
                        aria-hidden="true"
                    >
                        {group.content}
                    </span>
                )}
                <span className="mx_ReactionsDialog_railItemCount">{group.events.length}</span>
            </AccessibleButton>
        </li>
    );
}
