/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { JoinRule, type MatrixClient, type Room, RoomEvent, RoomType } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type RoomListHeaderViewSnapshot,
    type RoomListHeaderViewModel as RoomListHeaderViewModelInterface,
    type SpaceSwitcherItem,
    type NotificationDecorationData,
} from "@element-hq/web-shared-components";

import defaultDispatcher from "../../dispatcher/dispatcher";
import PosthogTrackers from "../../PosthogTrackers";
import { Action } from "../../dispatcher/actions";
import {
    getMetaSpaceName,
    type MetaSpace,
    type SpaceKey,
    UPDATE_HOME_BEHAVIOUR,
    UPDATE_SELECTED_SPACE,
    UPDATE_TOP_LEVEL_SPACES,
} from "../../stores/spaces";
import type SpaceStore from "../../stores/spaces/SpaceStore";
import {
    shouldShowSpaceSettings,
    showCreateNewRoom,
    showSpaceInvite,
    showSpacePreferences,
    showSpaceSettings,
} from "../../utils/space";
import type { ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import type { RoomListSectionsCollapseStateChangedPayload } from "../../dispatcher/payloads/RoomListSectionsCollapseStateChangedPayload";
import SettingsStore from "../../settings/SettingsStore";
import RoomListStoreV3 from "../../stores/room-list-v3/RoomListStoreV3";
import { createRoom, hasCreateRoomRights } from "./utils";
import { ReleaseAnnouncementStore } from "../../stores/ReleaseAnnouncementStore";
import { NotificationStateEvents, type NotificationState } from "../../stores/notifications/NotificationState";
import { NotificationLevel } from "../../stores/notifications/NotificationLevel";

export interface Props {
    /**
     * The Matrix client instance.
     */
    matrixClient: MatrixClient;
    /**
     * The space store instance.
     */
    spaceStore: SpaceStore;
}

/**
 * ViewModel for the RoomListHeader.
 * Manages the state and actions for the room list header.
 */
export class RoomListHeaderViewModel
    extends BaseViewModel<RoomListHeaderViewSnapshot, Props>
    implements RoomListHeaderViewModelInterface
{
    /**
     * Reference to the currently active space.
     * Used to manage event listeners.
     */
    private activeSpace: Room | null;

    /**
     * Haven: the notification states currently subscribed to for the switcher's own per-space
     * badges (see resyncSpaceNotificationSubscriptions) - keyed by space id so a resync can tell
     * which ones are new/gone without re-subscribing to ones that are still present.
     */
    private readonly notificationStates = new Map<string, NotificationState>();

    public constructor(props: Props) {
        super(props, getInitialSnapshot(props.spaceStore, props.matrixClient));

        // Haven: unsubscribe from whatever's in notificationStates at dispose time - registered
        // once here rather than per-resync, since the map itself (not this closure) is what
        // changes over time.
        this.disposables.track(() => {
            for (const state of this.notificationStates.values()) {
                state.off(NotificationStateEvents.Update, this.onSpaceNotificationUpdate);
            }
            this.notificationStates.clear();
        });
        this.resyncSpaceNotificationSubscriptions();

        // Listen for video rooms feature flag changes
        const settingsFeatureVideoRef = SettingsStore.watchSetting(
            "feature_video_rooms",
            null,
            this.onVideoRoomsFeatureFlagChange,
        );
        this.disposables.track(() => SettingsStore.unwatchSetting(settingsFeatureVideoRef));

        const settingsShowSectionsRef = SettingsStore.watchSetting(
            "RoomList.showSections",
            null,
            this.onShowSectionsChange,
        );
        this.disposables.track(() => SettingsStore.unwatchSetting(settingsShowSectionsRef));

        // Listen for space changes
        this.disposables.trackListener(props.spaceStore, UPDATE_SELECTED_SPACE, this.onSpaceChange);
        this.disposables.trackListener(props.spaceStore, UPDATE_HOME_BEHAVIOUR, this.onHomeBehaviourChange);
        // Haven: the switcher's own space list needs refreshing when spaces are added/removed/
        // reordered too, not just when the active one changes.
        this.disposables.trackListener(props.spaceStore, UPDATE_TOP_LEVEL_SPACES, this.onSpaceListChange);

        // Haven: toggling the spaces bar off/on flips whether the title acts as a switcher at all.
        const settingsShowSpacesBarRef = SettingsStore.watchSetting(
            "Haven.showSpacesBar",
            null,
            this.onShowSpacesBarChange,
        );
        this.disposables.track(() => SettingsStore.unwatchSetting(settingsShowSpacesBarRef));

        // Listen for space name changes
        this.activeSpace = props.spaceStore.activeSpaceRoom;
        if (this.activeSpace) {
            this.disposables.trackListener(this.activeSpace, RoomEvent.Name, this.onSpaceNameChange);
        }

        // Listen for section collapse state changes from RoomListViewModel
        const dispatcherRef = defaultDispatcher.register(this.onDispatch);
        this.disposables.track(() => defaultDispatcher.unregister(dispatcherRef));

        this.disposables.trackListener(
            ReleaseAnnouncementStore.instance,
            "releaseAnnouncementChanged",
            this.onReleaseAnnouncementChanged,
        );
    }

    /**
     * Handles space change events.
     */
    private readonly onSpaceChange = (): void => {
        const activeSpace = this.props.spaceStore.activeSpaceRoom;

        this.activeSpace?.off(RoomEvent.Name, this.onSpaceNameChange);
        this.activeSpace = activeSpace;

        // Add new room listener if needed
        if (this.activeSpace) {
            this.disposables.trackListener(this.activeSpace, RoomEvent.Name, this.onSpaceNameChange);
        }

        this.snapshot.merge({
            ...computeHeaderSpaceState(this.props.spaceStore, this.props.matrixClient),
        });
    };

    /**
     * Handles home behaviour change events.
     */
    private readonly onHomeBehaviourChange = (): void => {
        this.snapshot.merge({
            title: getHeaderTitle(this.props.spaceStore),
            spaceSwitcherItems: computeSpaceSwitcherItems(this.props.spaceStore),
        });
    };

    /**
     * Haven: handles a space being added/removed/reordered - refreshes the switcher's own list and
     * its notification-badge subscriptions (the set of spaces may have changed).
     */
    private readonly onSpaceListChange = (): void => {
        this.snapshot.merge({ spaceSwitcherItems: computeSpaceSwitcherItems(this.props.spaceStore) });
        this.resyncSpaceNotificationSubscriptions();
    };

    /**
     * Haven: subscribes to the notification state of every space currently in the switcher's list,
     * unsubscribing from ones no longer present - keeps the switcher's own badges live without
     * leaking listeners onto spaces that have since been removed/left. Idempotent for spaces that
     * are still present (diffed against notificationStates' existing keys).
     */
    private resyncSpaceNotificationSubscriptions(): void {
        const currentIds = new Set(this.snapshot.current.spaceSwitcherItems.map((item) => item.id));

        for (const [id, state] of this.notificationStates) {
            if (!currentIds.has(id)) {
                state.off(NotificationStateEvents.Update, this.onSpaceNotificationUpdate);
                this.notificationStates.delete(id);
            }
        }

        for (const id of currentIds) {
            if (!this.notificationStates.has(id)) {
                const state = this.props.spaceStore.getNotificationState(id as SpaceKey);
                state.on(NotificationStateEvents.Update, this.onSpaceNotificationUpdate);
                this.notificationStates.set(id, state);
            }
        }
    }

    /**
     * Haven: a subscribed space's notification state changed - refresh the switcher's own list so
     * its badges stay live.
     */
    private readonly onSpaceNotificationUpdate = (): void => {
        this.snapshot.merge({ spaceSwitcherItems: computeSpaceSwitcherItems(this.props.spaceStore) });
    };

    /**
     * Haven: handles Haven.showSpacesBar being toggled - flips whether the title acts as a
     * space-switcher at all (see RoomListHeaderViewSnapshot.showSpaceSwitcher).
     */
    private readonly onShowSpacesBarChange = (): void => {
        this.snapshot.merge({ showSpaceSwitcher: !SettingsStore.getValue("Haven.showSpacesBar") });
    };

    /**
     * Handles space name change events.
     */
    private onSpaceNameChange = (): void => {
        this.snapshot.merge({ title: getHeaderTitle(this.props.spaceStore) });
    };

    /**
     * Handles video rooms feature flag change events.
     */
    private readonly onVideoRoomsFeatureFlagChange = (): void => {
        this.snapshot.merge({
            canCreateVideoRoom: getCanCreateVideoRoom(this.snapshot.current.canCreateRoom),
        });
    };

    /**
     * Handles show sections setting change events.
     */
    private readonly onShowSectionsChange = (): void => {
        this.snapshot.merge({
            areSectionsEnabled: SettingsStore.getValue("RoomList.showSections"),
        });
    };

    public createChatRoom = (e: Event): void => {
        defaultDispatcher.fire(Action.CreateChat);
        PosthogTrackers.trackInteraction("WebRoomListHeaderPlusMenuCreateChatItem", e);
    };

    public createRoom = (e: Event): void => {
        createRoom(this.activeSpace);
        PosthogTrackers.trackInteraction("WebRoomListHeaderPlusMenuCreateRoomItem", e);
    };

    public createVideoRoom = (): void => {
        const type = SettingsStore.getValue("feature_element_call_video_rooms")
            ? RoomType.UnstableCall
            : RoomType.ElementVideo;
        if (this.activeSpace) {
            showCreateNewRoom(this.activeSpace, type);
        } else {
            defaultDispatcher.dispatch({
                action: Action.CreateRoom,
                type,
            });
        }
    };

    public openSpaceHome = (): void => {
        if (!this.activeSpace) return;
        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: this.activeSpace.roomId,
            metricsTrigger: undefined,
        });
    };

    public inviteInSpace = (): void => {
        if (!this.activeSpace) return;
        showSpaceInvite(this.activeSpace);
    };

    public openSpacePreferences = (): void => {
        if (!this.activeSpace) return;
        showSpacePreferences(this.activeSpace);
    };

    public openSpaceSettings = (): void => {
        if (!this.activeSpace) return;
        showSpaceSettings(this.activeSpace);
    };

    public createSection = (): void => {
        RoomListStoreV3.instance.createSection();
        PosthogTrackers.trackSectionCreation("RoomListHeader");
    };

    public collapseOrExpandSections = (): void => {
        const action =
            this.snapshot.current.collapseSections === "expand"
                ? Action.RoomListExpandAllSections
                : Action.RoomListCollapseAllSections;
        defaultDispatcher.fire(action);

        const kind = action === Action.RoomListExpandAllSections ? "Expand" : "Collapse";
        PosthogTrackers.trackCollapseOrExpandSection(kind, "RoomListHeader");
    };

    private readonly onDispatch = (payload: { action: string }): void => {
        if (payload.action === Action.RoomListSectionsCollapseStateChanged) {
            const { collapseSections } = payload as RoomListSectionsCollapseStateChangedPayload;
            this.snapshot.merge({
                collapseSections: collapseSections && (collapseSections === "collapse" ? "expand" : "collapse"),
            });
        }
    };

    public closeSectionReleaseAnnouncement = (): void => {
        ReleaseAnnouncementStore.instance.nextReleaseAnnouncement();
        this.snapshot.merge({ displaySectionReleaseAnnouncement: false });
    };

    /**
     * Haven: switch the active space, driven from the switcher menu (see
     * RoomListHeaderViewSnapshot.showSpaceSwitcher).
     */
    public switchToSpace = (id: string): void => {
        this.props.spaceStore.setActiveSpace(id as SpaceKey);
    };

    public onReleaseAnnouncementChanged = (): void => {
        const displaySectionReleaseAnnouncement =
            ReleaseAnnouncementStore.instance.getReleaseAnnouncement() === "room_list_section";
        this.snapshot.merge({ displaySectionReleaseAnnouncement });
    };
}

/**
 * Get the initial snapshot for the RoomListHeaderViewModel.
 * @param spaceStore - The space store instance.
 * @param matrixClient - The Matrix client instance.
 * @returns
 */
function getInitialSnapshot(spaceStore: SpaceStore, matrixClient: MatrixClient): RoomListHeaderViewSnapshot {
    return computeHeaderSpaceState(spaceStore, matrixClient);
}

/**
 * Get the header title based on the active space.
 * @param spaceStore - The space store instance.
 */
function getHeaderTitle(spaceStore: SpaceStore): string {
    const activeSpace = spaceStore.activeSpaceRoom;
    const spaceName = activeSpace?.name;
    return spaceName ?? getMetaSpaceName(spaceStore.activeSpace as MetaSpace, spaceStore.allRoomsInHome);
}

/**
 * Determine if the user can create a video room.
 * @param canCreateRoom - Whether the user can create a room.
 */
function getCanCreateVideoRoom(canCreateRoom: boolean): boolean {
    return SettingsStore.getValue("feature_video_rooms") && canCreateRoom;
}

/**
 * Computes the header space state based on the active space and user permissions.
 * @param spaceStore - The space store instance.
 * @param matrixClient - The Matrix client instance.
 * @returns The header space state containing title, permissions, and display flags.
 */
function computeHeaderSpaceState(spaceStore: SpaceStore, matrixClient: MatrixClient): RoomListHeaderViewSnapshot {
    const displaySectionReleaseAnnouncement =
        ReleaseAnnouncementStore.instance.getReleaseAnnouncement() === "room_list_section";
    const areSectionsEnabled = SettingsStore.getValue("RoomList.showSections");

    const activeSpace = spaceStore.activeSpaceRoom;
    const title = getHeaderTitle(spaceStore);

    const canCreateRoom = hasCreateRoomRights(matrixClient, activeSpace);
    const canCreateVideoRoom = getCanCreateVideoRoom(canCreateRoom);
    const displaySpaceMenu = Boolean(activeSpace);
    const canInviteInSpace = Boolean(
        activeSpace?.getJoinRule() === JoinRule.Public || activeSpace?.canInvite(matrixClient.getSafeUserId()),
    );
    const canAccessSpaceSettings = Boolean(activeSpace && shouldShowSpaceSettings(activeSpace));

    return {
        title,
        canCreateRoom,
        canCreateVideoRoom,
        displaySpaceMenu,
        canInviteInSpace,
        canAccessSpaceSettings,
        displaySectionReleaseAnnouncement,
        areSectionsEnabled,
        showSpaceSwitcher: !SettingsStore.getValue("Haven.showSpacesBar"),
        spaceSwitcherItems: computeSpaceSwitcherItems(spaceStore),
    };
}

/**
 * Haven: computes the list of spaces to show in the switcher menu (see
 * RoomListHeaderViewSnapshot.showSpaceSwitcher) - the same set the spaces bar itself would show
 * (enabled meta-spaces, then real top-level spaces), so switching Haven.showSpacesBar off doesn't
 * also change which spaces are reachable, only how you get to them.
 * @param spaceStore - The space store instance.
 */
function computeSpaceSwitcherItems(spaceStore: SpaceStore): SpaceSwitcherItem[] {
    const activeSpace = spaceStore.activeSpace;

    const buildItem = (id: string, name: string): SpaceSwitcherItem => ({
        id,
        name,
        isActive: activeSpace === id,
        notification: toNotificationDecorationData(spaceStore.getNotificationState(id as SpaceKey)),
    });

    const metaSpaceItems = spaceStore.enabledMetaSpaces.map((key) =>
        buildItem(key, getMetaSpaceName(key, spaceStore.allRoomsInHome)),
    );

    const realSpaceItems = spaceStore.spacePanelSpaces.map((room) => buildItem(room.roomId, room.name));

    return [...metaSpaceItems, ...realSpaceItems];
}

/**
 * Haven: maps a space's NotificationState (used by the spaces bar itself) to the shared-components
 * NotificationDecorationData shape (used by the switcher menu's own badge, and already used for
 * room list items/section headers) - lets the switcher reuse that existing, matrix-client-agnostic
 * renderer instead of needing its own notification-badge component.
 * @param state - The space's notification state (see SpaceStore.getNotificationState).
 */
function toNotificationDecorationData(state: NotificationState): NotificationDecorationData {
    const level = state.level;
    return {
        // Mirrors NotificationBadge.tsx's own "nothing to show" check (isIdle && !knocked).
        hasAnyNotificationOrActivity: !state.isIdle || state.knocked,
        isUnsentMessage: level === NotificationLevel.Unsent,
        isMention: level === NotificationLevel.Highlight,
        isNotification: level === NotificationLevel.Notification,
        isActivityNotification: level === NotificationLevel.Activity,
        hasUnreadCount: state.hasUnreadCount,
        count: state.count,
        invited: state.invited,
        muted: state.muted,
    };
}
