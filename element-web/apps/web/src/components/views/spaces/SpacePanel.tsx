/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2021, 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type ComponentProps,
    type Dispatch,
    type ReactNode,
    type RefCallback,
    type SetStateAction,
    type JSX,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useContext,
} from "react";
import { createPortal } from "react-dom";
import { DragDropContext, Draggable, Droppable, type DroppableProvidedProps } from "react-beautiful-dnd";
import classNames from "classnames";
import { type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import {
    FavouriteSolidIcon,
    HomeSolidIcon,
    RoomIcon,
    VideoCallSolidIcon,
    UserProfileSolidIcon,
    PlusIcon,
    ChevronRightIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { useCreateAutoDisposedViewModel, UserMenu } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import { useContextMenu } from "../../structures/ContextMenu";
import SpaceCreateMenu from "./SpaceCreateMenu";
import { SpaceButton, SpaceItem } from "./SpaceTreeLevel";
import { useEventEmitter, useEventEmitterState } from "../../../hooks/useEventEmitter";
import SpaceStore from "../../../stores/spaces/SpaceStore";
import {
    getMetaSpaceName,
    isMetaSpace,
    MetaSpace,
    type SpaceKey,
    UPDATE_HOME_BEHAVIOUR,
    UPDATE_INVITED_SPACES,
    UPDATE_SELECTED_SPACE,
    UPDATE_TOP_LEVEL_SPACES,
} from "../../../stores/spaces";
import { RovingTabIndexProvider } from "../../../accessibility/RovingTabIndex";
import {
    RoomNotificationStateStore,
    UPDATE_STATUS_INDICATOR,
} from "../../../stores/notifications/RoomNotificationStateStore";
import type SpaceContextMenu from "../context_menus/SpaceContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import UIStore from "../../../stores/UIStore";
import QuickSettingsButton from "./QuickSettingsButton";
import { useSettingValue } from "../../../hooks/useSettings";
import IndicatorScrollbar from "../../structures/IndicatorScrollbar";
import { useDispatcher } from "../../../hooks/useDispatcher";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { type ActionPayload } from "../../../dispatcher/payloads";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { type NotificationState } from "../../../stores/notifications/NotificationState";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { shouldShowComponent } from "../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../settings/UIFeature";
import { ThreadsActivityCentre } from "./threads-activity-centre/";
import AccessibleButton from "../elements/AccessibleButton";
import { Landmark, LandmarkNavigation } from "../../../accessibility/LandmarkNavigation";
// haven apps-framework patch
import { SpacePanelAppButtons } from "../../../../../../../src/apps/framework/components/SpacePanelAppButtons";
import { AppsButton } from "../../../../../../../src/apps/framework/components/AppsButton";
import { useActiveAppId } from "../../../../../../../src/apps/framework/hooks/useActiveAppId";
import { getEnabledApps } from "../../../../../../../src/apps/framework/registry";
import { KeyboardShortcut } from "../settings/KeyboardShortcut";
import { ModuleApi } from "../../../modules/Api.ts";
import { useModuleSpacePanelItems } from "../../../modules/ExtrasApi.ts";
import { UserMenuViewModel } from "../../../viewmodels/menus/UserMenuViewModel.ts";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext.tsx";
import { SDKContext } from "../../../contexts/SDKContext.ts";

const useSpaces = (): [Room[], MetaSpace[], Room[], SpaceKey] => {
    const invites = useEventEmitterState<Room[]>(SpaceStore.instance, UPDATE_INVITED_SPACES, () => {
        return SpaceStore.instance.invitedSpaces;
    });
    const [metaSpaces, actualSpaces] = useEventEmitterState<[MetaSpace[], Room[]]>(
        SpaceStore.instance,
        UPDATE_TOP_LEVEL_SPACES,
        () => [SpaceStore.instance.enabledMetaSpaces, SpaceStore.instance.spacePanelSpaces],
    );
    const activeSpace = useEventEmitterState<SpaceKey>(SpaceStore.instance, UPDATE_SELECTED_SPACE, () => {
        return SpaceStore.instance.activeSpace;
    });
    return [invites, metaSpaces, actualSpaces, activeSpace];
};

export const HomeButtonContextMenu: React.FC<ComponentProps<typeof SpaceContextMenu>> = ({
    onFinished,
    hideHeader,
    ...props
}) => {
    const allRoomsInHome = useSettingValue("Spaces.allRoomsInHome");

    return (
        <IconizedContextMenu {...props} onFinished={onFinished} className="mx_SpacePanel_contextMenu" compact>
            {!hideHeader && <div className="mx_SpacePanel_contextMenu_header">{_t("common|home")}</div>}
            <IconizedContextMenuOptionList first>
                <IconizedContextMenuCheckbox
                    label={_t("settings|sidebar|metaspaces_home_all_rooms")}
                    active={allRoomsInHome}
                    onClick={() => {
                        onFinished();
                        SettingsStore.setValue("Spaces.allRoomsInHome", null, SettingLevel.ACCOUNT, !allRoomsInHome);
                    }}
                />
            </IconizedContextMenuOptionList>
        </IconizedContextMenu>
    );
};

interface IMetaSpaceButtonProps extends ComponentProps<typeof SpaceButton> {
    selected: boolean;
    isPanelCollapsed: boolean;
    icon: JSX.Element;
}

type MetaSpaceButtonProps = Pick<IMetaSpaceButtonProps, "selected" | "isPanelCollapsed">;

const MetaSpaceButton: React.FC<IMetaSpaceButtonProps> = ({ selected, isPanelCollapsed, size = "32px", ...props }) => {
    return (
        <li
            className={classNames("mx_SpaceItem", {
                collapsed: isPanelCollapsed,
            })}
            role="treeitem"
            aria-selected={selected}
        >
            <SpaceButton {...props} selected={selected} isNarrow={isPanelCollapsed} size={size} />
        </li>
    );
};

const getHomeNotificationState = (): NotificationState => {
    return SpaceStore.instance.allRoomsInHome
        ? RoomNotificationStateStore.instance.globalState
        : SpaceStore.instance.getNotificationState(MetaSpace.Home);
};

const HomeButton: React.FC<MetaSpaceButtonProps> = ({ selected, isPanelCollapsed }) => {
    const allRoomsInHome = useEventEmitterState(SpaceStore.instance, UPDATE_HOME_BEHAVIOUR, () => {
        return SpaceStore.instance.allRoomsInHome;
    });
    const [notificationState, setNotificationState] = useState(getHomeNotificationState());
    const updateNotificationState = useCallback(() => {
        setNotificationState(getHomeNotificationState());
    }, []);
    useEffect(updateNotificationState, [updateNotificationState, allRoomsInHome]);
    useEventEmitter(RoomNotificationStateStore.instance, UPDATE_STATUS_INDICATOR, updateNotificationState);

    return (
        <MetaSpaceButton
            spaceKey={MetaSpace.Home}
            selected={selected}
            isPanelCollapsed={isPanelCollapsed}
            label={getMetaSpaceName(MetaSpace.Home, allRoomsInHome)}
            notificationState={notificationState}
            ContextMenuComponent={HomeButtonContextMenu}
            contextMenuTooltip={_t("common|options")}
            size="32px"
            icon={<HomeSolidIcon />}
        />
    );
};

const FavouritesButton: React.FC<MetaSpaceButtonProps> = ({ selected, isPanelCollapsed }) => {
    return (
        <MetaSpaceButton
            spaceKey={MetaSpace.Favourites}
            selected={selected}
            isPanelCollapsed={isPanelCollapsed}
            label={getMetaSpaceName(MetaSpace.Favourites)}
            notificationState={SpaceStore.instance.getNotificationState(MetaSpace.Favourites)}
            size="32px"
            icon={<FavouriteSolidIcon />}
        />
    );
};

const PeopleButton: React.FC<MetaSpaceButtonProps> = ({ selected, isPanelCollapsed }) => {
    return (
        <MetaSpaceButton
            spaceKey={MetaSpace.People}
            selected={selected}
            isPanelCollapsed={isPanelCollapsed}
            label={getMetaSpaceName(MetaSpace.People)}
            notificationState={SpaceStore.instance.getNotificationState(MetaSpace.People)}
            size="32px"
            icon={<UserProfileSolidIcon />}
        />
    );
};

const OrphansButton: React.FC<MetaSpaceButtonProps> = ({ selected, isPanelCollapsed }) => {
    return (
        <MetaSpaceButton
            spaceKey={MetaSpace.Orphans}
            selected={selected}
            isPanelCollapsed={isPanelCollapsed}
            label={getMetaSpaceName(MetaSpace.Orphans)}
            notificationState={SpaceStore.instance.getNotificationState(MetaSpace.Orphans)}
            size="32px"
            icon={<RoomIcon />}
        />
    );
};

const VideoRoomsButton: React.FC<MetaSpaceButtonProps> = ({ selected, isPanelCollapsed }) => {
    return (
        <MetaSpaceButton
            spaceKey={MetaSpace.VideoRooms}
            selected={selected}
            isPanelCollapsed={isPanelCollapsed}
            label={getMetaSpaceName(MetaSpace.VideoRooms)}
            notificationState={SpaceStore.instance.getNotificationState(MetaSpace.VideoRooms)}
            size="32px"
            icon={<VideoCallSolidIcon />}
        />
    );
};

const CreateSpaceButton: React.FC<Pick<IInnerSpacePanelProps, "isPanelCollapsed" | "setPanelCollapsed">> = ({
    isPanelCollapsed,
    setPanelCollapsed,
}) => {
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLDivElement>();

    useEffect(() => {
        if (!isPanelCollapsed && menuDisplayed) {
            closeMenu();
        }
    }, [isPanelCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

    let contextMenu: JSX.Element | undefined;
    if (menuDisplayed) {
        contextMenu = <SpaceCreateMenu onFinished={closeMenu} />;
    }

    const onNewClick = menuDisplayed
        ? closeMenu
        : () => {
              if (!isPanelCollapsed) setPanelCollapsed(true);
              openMenu();
          };

    return (
        <li
            className={classNames("mx_SpaceItem mx_SpaceItem_new", {
                collapsed: isPanelCollapsed,
            })}
            role="treeitem"
            aria-selected={false}
        >
            <SpaceButton
                data-testid="create-space-button"
                className={classNames("mx_SpaceButton_new", {
                    mx_SpaceButton_newCancel: menuDisplayed,
                })}
                label={menuDisplayed ? _t("action|cancel") : _t("create_space|label")}
                onClick={onNewClick}
                isNarrow={isPanelCollapsed}
                innerRef={handle}
                size="32px"
                icon={<PlusIcon />}
            />

            {contextMenu}
        </li>
    );
};

const metaSpaceComponentMap: Record<MetaSpace, typeof HomeButton> = {
    [MetaSpace.Home]: HomeButton,
    [MetaSpace.Favourites]: FavouritesButton,
    [MetaSpace.People]: PeopleButton,
    [MetaSpace.Orphans]: OrphansButton,
    [MetaSpace.VideoRooms]: VideoRoomsButton,
};

interface IInnerSpacePanelProps extends DroppableProvidedProps {
    children?: ReactNode;
    isPanelCollapsed: boolean;
    setPanelCollapsed: Dispatch<SetStateAction<boolean>>;
    isDraggingOver: boolean;
    innerRef: RefCallback<HTMLElement>;
}

// Optimisation based on https://github.com/atlassian/react-beautiful-dnd/blob/master/docs/api/droppable.md#recommended-droppable--performance-optimisation
const InnerSpacePanel = React.memo<IInnerSpacePanelProps>(
    ({ children, isPanelCollapsed, setPanelCollapsed, isDraggingOver, innerRef, ...props }) => {
        const [invites, metaSpaces, actualSpaces, activeSpace] = useSpaces();

        // haven apps-framework patch: track whether an app is open so we can deselect both the
        // meta-space buttons (below) and real (room-backed) Spaces (activeSpaces, consumed by the
        // invites/actualSpaces SpaceItems further down) — without this, a Space clicked before
        // opening/reopening an app keeps its mx_SpaceButton_active highlight forever, since
        // SpaceStore.activeSpace itself is only ever updated by clicking a Space, never cleared by
        // clicking an app icon.
        const client = useMatrixClientContext();
        const activeAppId = useActiveAppId();
        const isAppMode = activeAppId !== null;
        const activeSpaces = isAppMode ? [] : activeSpace ? [activeSpace] : [];

        const moduleSpaceItems = useModuleSpacePanelItems(ModuleApi.instance.extras);

        const metaSpacesSection = metaSpaces
            .filter((key) => !(key === MetaSpace.VideoRooms && !SettingsStore.getValue("feature_video_rooms")))
            .map((key) => {
                const Component = metaSpaceComponentMap[key];
                return <Component key={key} selected={activeSpace === key} isPanelCollapsed={isPanelCollapsed} />;
            });

        const deselectedMetaSpacesSection = isAppMode
            ? metaSpacesSection.map((el) => React.cloneElement(el, { selected: false }))
            : metaSpacesSection;

        // haven apps-framework patch: dispatch ViewHomePage on meta-space button clicks while an app
        // is open, so SpaceStore.setActiveSpace's early-return (same space already active) doesn't
        // leave us stuck. Excludes Haven app buttons (.haven_SpaceAppItem) and Create Space (.mx_SpaceItem_new).
        //
        // Special-cased below: if the clicked space/meta-space is the SAME one that was already
        // active before an app was opened, that early-return isn't just an obstacle to route
        // around - it also means the clicked button's own onClick (SpaceStore.setActiveSpace) is
        // about to no-op entirely, since opening an app never itself changes SpaceStore's own
        // activeSpace. That skips setActiveSpace's own "view last selected room in this space"
        // logic (see its own contextSwitch branch), which is why returning to e.g. Home from an
        // app always landed on the generic /#home page instead of whatever room was open there
        // before - reproduced directly here instead, since going through setActiveSpace itself
        // would just hit the same early-return again.
        //
        // Dispatched synchronously (third arg `true`): defaultDispatcher.dispatch() defaults to
        // deferring processing via setTimeout(0). Since this handler runs in the *capture* phase
        // (fires before the clicked space button's own bubble-phase onClick, which synchronously
        // calls SpaceStore.setActiveSpace), an async dispatch here would only resolve *after* that
        // onClick already ran and dispatched its own (also-async) navigation for the actually-clicked
        // space — so this ViewHomePage dispatch would land last and clobber it, leaving the panel
        // stuck on Home until a second click. Dispatching synchronously ensures we've fully exited
        // app mode before the space's own click handler executes, so it navigates correctly the
        // first time.
        const handleMetaSpaceClickCapture = isAppMode
            ? (e: React.MouseEvent) => {
                  const target = e.target as HTMLElement;
                  if (target.closest(".haven_SpaceAppItem, .mx_SpaceItem_new")) return;
                  if (!target.closest(".mx_SpaceItem")) return;

                  const clickedSpaceKey = target.closest("[data-space-key]")?.getAttribute("data-space-key") as
                      | SpaceKey
                      | undefined;

                  if (clickedSpaceKey && clickedSpaceKey === activeSpace) {
                      const roomId = SpaceStore.instance.getLastSelectedRoomIdForSpace(clickedSpaceKey);
                      const cliSpace = isMetaSpace(clickedSpaceKey) ? null : client.getRoom(clickedSpaceKey);
                      if (
                          roomId &&
                          cliSpace?.getMyMembership() !== KnownMembership.Invite &&
                          client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join &&
                          SpaceStore.instance.isRoomInSpace(clickedSpaceKey, roomId)
                      ) {
                          defaultDispatcher.dispatch<ViewRoomPayload>(
                              {
                                  action: Action.ViewRoom,
                                  room_id: roomId,
                                  context_switch: true,
                                  metricsTrigger: "WebSpaceContextSwitch",
                              },
                              true,
                          );
                          return;
                      }
                  }

                  defaultDispatcher.dispatch({ action: Action.ViewHomePage }, true);
              }
            : undefined;

        return (
            <IndicatorScrollbar
                {...props}
                wrappedRef={innerRef}
                className="mx_SpaceTreeLevel"
                style={
                    isDraggingOver
                        ? {
                              pointerEvents: "none",
                          }
                        : undefined
                }
                as="ul"
                role="tree"
                aria-label={_t("common|spaces")}
                onClickCapture={handleMetaSpaceClickCapture}
            >
                {/* haven apps-framework patch: Apps launcher button, then pinned/open app buttons,
                    above Home - both the button and its divider disappear together when there's
                    nothing to launch (see AppsButton's own identical check), rather than leaving a
                    divider with nothing above it to separate from the spaces below. */}
                <AppsButton client={client} variant="spacebar" isPanelCollapsed={isPanelCollapsed} />
                <SpacePanelAppButtons client={client} isPanelCollapsed={isPanelCollapsed} />
                {getEnabledApps().length > 0 && (
                    <li className="haven_SpacePanel_divider" role="none" aria-hidden="true" />
                )}
                {deselectedMetaSpacesSection}
                {invites.map((s) => (
                    <SpaceItem
                        key={s.roomId}
                        space={s}
                        activeSpaces={activeSpaces}
                        isPanelCollapsed={isPanelCollapsed}
                        onExpand={() => setPanelCollapsed(false)}
                    />
                ))}
                {actualSpaces.map((s, i) => (
                    <Draggable key={s.roomId} draggableId={s.roomId} index={i}>
                        {(provided, snapshot) => (
                            <SpaceItem
                                {...provided.draggableProps}
                                dragHandleProps={provided.dragHandleProps}
                                key={s.roomId}
                                innerRef={provided.innerRef}
                                className={snapshot.isDragging ? "mx_SpaceItem_dragging" : undefined}
                                space={s}
                                activeSpaces={activeSpaces}
                                isPanelCollapsed={isPanelCollapsed}
                                onExpand={() => setPanelCollapsed(false)}
                            />
                        )}
                    </Draggable>
                ))}
                {children}
                {moduleSpaceItems.map((item) => (
                    <li
                        key={item.spaceKey}
                        className={classNames("mx_SpaceItem", {
                            collapsed: isPanelCollapsed,
                        })}
                        role="treeitem"
                        aria-selected={false} // TODO
                    >
                        <SpaceButton
                            {...item}
                            isNarrow={isPanelCollapsed}
                            size="32px"
                            selected={activeSpace === item.spaceKey}
                            onClick={() => {
                                SpaceStore.instance.setActiveSpace(item.spaceKey);
                                item.onSelected?.();
                            }}
                        />
                    </li>
                ))}
                {shouldShowComponent(UIComponent.CreateSpaces) && (
                    <CreateSpaceButton isPanelCollapsed={isPanelCollapsed} setPanelCollapsed={setPanelCollapsed} />
                )}
            </IndicatorScrollbar>
        );
    },
);

interface IProps {
    // haven apps-framework patch: DOM node (rendered by LeftPanel/RoomListPanel next to the search
    // bar) to portal the UserMenu into when the spaces bar is hidden — see Haven.showSpacesBar.
    userMenuPortalTarget?: HTMLDivElement | null;
}

const SpacePanel: React.FC<IProps> = ({ userMenuPortalTarget }) => {
    const client = useMatrixClientContext();
    // haven apps-framework patch
    const showSpacesBar = useSettingValue("Haven.showSpacesBar");
    const [dragging, setDragging] = useState(false);
    const [isPanelCollapsed, setPanelCollapsed] = useState(true);
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (ref.current) UIStore.instance.trackElementDimensions("SpacePanel", ref.current);
        return () => UIStore.instance.stopTrackingElementDimensions("SpacePanel");
    }, []);
    const sdkContext = useContext(SDKContext);

    useDispatcher(defaultDispatcher, (payload: ActionPayload) => {
        if (payload.action === Action.ToggleSpacePanel) {
            setPanelCollapsed(!isPanelCollapsed);
        }
    });

    const newRoomListEnabled = useSettingValue("feature_new_room_list");

    const userMenuVm = useCreateAutoDisposedViewModel(
        () =>
            new UserMenuViewModel(
                defaultDispatcher,
                client,
                isPanelCollapsed,
                sdkContext.oidcClientStore.accountManagementEndpoint,
            ),
    );

    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action === Action.ToggleUserMenu) {
            userMenuVm.setOpen(!userMenuVm.getSnapshot().open);
        }
    });

    useEffect(() => {
        // haven apps-framework patch: when relocated next to the search bar (spaces bar hidden),
        // isPanelCollapsed is meaningless (the panel it describes isn't shown) — always compact.
        userMenuVm.setExpanded(showSpacesBar && !isPanelCollapsed);
    }, [userMenuVm, isPanelCollapsed, showSpacesBar]);

    return (
        <RovingTabIndexProvider handleHomeEnd handleUpDown={!dragging}>
            {({ onKeyDownHandler, onDragEndHandler }) => (
                <DragDropContext
                    onDragStart={() => {
                        setDragging(true);
                    }}
                    onDragEnd={(result) => {
                        setDragging(false);
                        if (!result.destination) return; // dropped outside the list
                        SpaceStore.instance.moveRootSpace(result.source.index, result.destination.index);
                        onDragEndHandler();
                    }}
                >
                    <nav
                        className={classNames("mx_SpacePanel", {
                            collapsed: isPanelCollapsed,
                            newUi: newRoomListEnabled,
                            // haven apps-framework patch
                            haven_SpacePanel_hidden: !showSpacesBar,
                        })}
                        onKeyDown={(ev) => {
                            const navAction = getKeyBindingsManager().getNavigationAction(ev);
                            if (
                                navAction === KeyBindingAction.NextLandmark ||
                                navAction === KeyBindingAction.PreviousLandmark
                            ) {
                                LandmarkNavigation.findAndFocusNextLandmark(
                                    Landmark.ACTIVE_SPACE_BUTTON,
                                    navAction === KeyBindingAction.PreviousLandmark,
                                );
                                ev.stopPropagation();
                                ev.preventDefault();
                                return;
                            }
                            onKeyDownHandler(ev);
                        }}
                        ref={ref}
                        aria-label={_t("common|spaces")}
                    >
                        {/* haven apps-framework patch: when the spaces bar is hidden, portal the
                            UserMenu out to the slot LeftPanel/RoomListPanel render next to the
                            search bar instead of rendering it here (where it'd be invisible under
                            haven_SpacePanel_hidden) — same ViewModel instance either way. */}
                        {showSpacesBar || !userMenuPortalTarget ? (
                            <UserMenu vm={userMenuVm} className="mx_UserMenu" />
                        ) : (
                            createPortal(
                                <>
                                    <UserMenu vm={userMenuVm} className="mx_UserMenu haven_UserMenu_relocated" />
                                    {/* haven apps-framework patch: Apps button to the right of the
                                        relocated UserMenu, in both regular and app (e.g. Social) mode */}
                                    <AppsButton client={client} variant="compact" />
                                </>,
                                userMenuPortalTarget,
                            )
                        )}
                        <AccessibleButton
                            className={classNames("mx_SpacePanel_toggleCollapse", {
                                expanded: !isPanelCollapsed,
                            })}
                            onClick={() => setPanelCollapsed(!isPanelCollapsed)}
                            title={isPanelCollapsed ? _t("action|expand") : _t("action|collapse")}
                            caption={
                                <KeyboardShortcut
                                    value={{ ctrlOrCmdKey: true, shiftKey: true, key: "d" }}
                                    className="mx_SpacePanel_Tooltip_KeyboardShortcut"
                                />
                            }
                        >
                            <ChevronRightIcon />
                        </AccessibleButton>
                        <Droppable droppableId="top-level-spaces">
                            {(provided, snapshot) => (
                                <InnerSpacePanel
                                    {...provided.droppableProps}
                                    isPanelCollapsed={isPanelCollapsed}
                                    setPanelCollapsed={setPanelCollapsed}
                                    isDraggingOver={snapshot.isDraggingOver}
                                    innerRef={provided.innerRef}
                                >
                                    {provided.placeholder}
                                </InnerSpacePanel>
                            )}
                        </Droppable>

                        <ThreadsActivityCentre displayButtonLabel={!isPanelCollapsed} />

                        <QuickSettingsButton isPanelCollapsed={isPanelCollapsed} />
                    </nav>
                </DragDropContext>
            )}
        </RovingTabIndexProvider>
    );
};

export default SpacePanel;
