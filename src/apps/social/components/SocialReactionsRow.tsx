/*
 * Social Overlay — SocialReactionsRow
 *
 * Reaction pills on posts, between the post content and the bottom control row. Reuses the exact
 * same pieces stock Element uses for message reactions in normal rooms — ReactionsRowView /
 * ReactionsRowButtonView (rendering + the green "you reacted with this" accent), the
 * ReactionsRowButtonAdapter (per-pill click-to-toggle behaviour), and ReactionsRowViewModel (the
 * row's own visibility/show-all logic) — none of that is reimplemented here.
 *
 * The one thing genuinely adapted rather than reused: ReactionsRowAdapter.tsx (stock) gets its
 * canReact/canSelfRedact from the legacy RoomContext and its ReactionsRowViewModel instance from
 * EventTileViewModel (both real-timeline-only concepts Social doesn't have). This constructs
 * ReactionsRowViewModel directly — a plain, timeline-independent class — and takes canReact /
 * canSelfRedact as explicit props from the caller, which already knows whether the current user
 * can post/react in this room.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { uniqBy } from "lodash";
import {
    type MatrixClient,
    type MatrixEvent,
    type Relations,
    RelationsEvent,
    RelationType,
    EventType,
} from "matrix-js-sdk/src/matrix";
import { ReactionsRowView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";

import ContextMenu, { aboveLeftOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import ReactionPicker from "../../../../element-web/apps/web/src/components/views/emojipicker/ReactionPicker";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { isContentActionable } from "../../../../element-web/apps/web/src/utils/EventUtils";
import {
    ReactionsRowViewModel,
    MAX_ITEMS_WHEN_LIMITED,
} from "../../../../element-web/apps/web/src/viewmodels/room/timeline/event-tile/reactions/ReactionsRowViewModel";
import {
    ReactionsRowButtonAdapter,
    getReactionGroups,
    getMyReactions,
} from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";

interface Props {
    client: MatrixClient;
    mxEvent: MatrixEvent;
    reactions?: Relations | null;
    canReact: boolean;
    canSelfRedact: boolean;
}

// 👍 and 🔁 each have their own dedicated action-bar button (LikeButton, Repost) that always shows
// that reaction's own count directly now - filtered out of this row's own pills so the same number
// doesn't show twice. Every other reaction (❤️, 😂, custom, etc.) still shows here as normal, since
// none of those have a dedicated button of their own. Exception: with developer mode on, show them
// here too - useful for inspecting the raw reaction data (who reacted, exact timestamps, etc.) that
// the action-bar buttons only ever summarize as a bare count.
function filterActionBarReactions(groups: ReturnType<typeof getReactionGroups>): ReturnType<typeof getReactionGroups> {
    if (SettingsStore.getValue("developerMode")) return groups;
    return groups.filter(({ content }) => content !== "👍" && content !== "🔁");
}

export function SocialReactionsRow({ client, mxEvent, reactions, canReact, canSelfRedact }: Props): JSX.Element | null {
    const userId = client.getUserId() ?? undefined;
    const [reactionGroups, setReactionGroups] = useState(() => filterActionBarReactions(getReactionGroups(reactions)));
    const [myReactions, setMyReactions] = useState(() => getMyReactions(reactions, userId));
    const [menuDisplayed, setMenuDisplayed] = useState(false);
    const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);

    const vm = useCreateAutoDisposedViewModel(
        () =>
            new ReactionsRowViewModel({
                isActionable: isContentActionable(mxEvent),
                reactionGroupCount: reactionGroups.length,
                canReact,
                addReactionButtonActive: false,
            }),
    );

    const openReactionMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
        setMenuAnchorRect(event.currentTarget.getBoundingClientRect());
        setMenuDisplayed(true);
    }, []);

    const closeReactionMenu = useCallback((): void => {
        setMenuDisplayed(false);
    }, []);

    const updateReactionsState = useCallback((): void => {
        const nextReactionGroups = filterActionBarReactions(getReactionGroups(reactions));
        setReactionGroups(nextReactionGroups);
        setMyReactions(getMyReactions(reactions, userId));
        vm.setReactionGroupCount(nextReactionGroups.length);
    }, [reactions, userId, vm]);

    useEffect(() => {
        vm.setActionable(isContentActionable(mxEvent));
    }, [mxEvent, vm]);

    useEffect(() => {
        vm.setCanReact(canReact);
        if (!canReact && menuDisplayed) {
            setMenuDisplayed(false);
        }
    }, [canReact, menuDisplayed, vm]);

    useEffect(() => {
        vm.setAddReactionHandlers({
            onAddReactionClick: openReactionMenu,
            onAddReactionContextMenu: openReactionMenu,
        });
    }, [openReactionMenu, vm]);

    useEffect(() => {
        vm.setAddReactionButtonActive(menuDisplayed);
    }, [menuDisplayed, vm]);

    useEffect(() => {
        updateReactionsState();
    }, [updateReactionsState]);

    useEffect(() => {
        if (!reactions) return;

        reactions.on(RelationsEvent.Add, updateReactionsState);
        reactions.on(RelationsEvent.Remove, updateReactionsState);
        reactions.on(RelationsEvent.Redaction, updateReactionsState);

        return () => {
            reactions.off(RelationsEvent.Add, updateReactionsState);
            reactions.off(RelationsEvent.Remove, updateReactionsState);
            reactions.off(RelationsEvent.Redaction, updateReactionsState);
        };
    }, [reactions, updateReactionsState]);

    const snapshot = useViewModel(vm);
    const customReactionImagesEnabled = SettingsStore.getValue("feature_render_reaction_images");
    const items = useMemo((): JSX.Element[] | undefined => {
        const mappedItems = reactionGroups.map(({ content, events }) => {
            // Deduplicate reaction events by sender per Matrix spec.
            const deduplicatedEvents = uniqBy(events, (event: MatrixEvent) => event.getSender());
            const myReactionEvent = myReactions?.find((reactionEvent) => {
                if (reactionEvent.isRedacted()) {
                    return false;
                }
                return reactionEvent.getRelation()?.key === content;
            });

            return (
                <ReactionsRowButtonAdapter
                    key={content}
                    content={content}
                    count={deduplicatedEvents.length}
                    mxEvent={mxEvent}
                    reactionEvents={deduplicatedEvents}
                    myReactionEvent={myReactionEvent}
                    customReactionImagesEnabled={customReactionImagesEnabled}
                    disabled={!canReact || (myReactionEvent && !myReactionEvent.isRedacted() && !canSelfRedact)}
                />
            );
        });

        if (!mappedItems.length) {
            return undefined;
        }

        return snapshot.showAllButtonVisible ? mappedItems.slice(0, MAX_ITEMS_WHEN_LIMITED) : mappedItems;
    }, [reactionGroups, myReactions, mxEvent, customReactionImagesEnabled, canReact, canSelfRedact, snapshot.showAllButtonVisible]);

    if (!snapshot.isVisible || !items?.length) {
        return null;
    }

    let contextMenu: JSX.Element | undefined;
    if (menuDisplayed && menuAnchorRect && reactions && canReact) {
        contextMenu = (
            <ContextMenu {...aboveLeftOf(menuAnchorRect)} onFinished={closeReactionMenu} managed={false} focusLock>
                <ReactionPicker mxEvent={mxEvent} reactions={reactions} onFinished={closeReactionMenu} />
            </ContextMenu>
        );
    }

    return (
        <>
            <ReactionsRowView vm={vm} className="mx_ReactionsRow">
                {items}
            </ReactionsRowView>
            {contextMenu}
        </>
    );
}

/** Fetches the reaction (m.annotation) relations for a post the same way the room timeline does —
 *  via the room's own relations index, just called directly instead of through a timeline's
 *  getRelationsForEvent prop (Social has no timeline object to supply one). */
export function getPostReactions(client: MatrixClient, roomId: string, eventId: string): Relations | null {
    const room = client.getRoom(roomId);
    return room?.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction) ?? null;
}
