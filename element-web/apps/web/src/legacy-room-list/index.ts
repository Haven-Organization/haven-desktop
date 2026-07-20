/*
 * Haven: single entry point for the legacy (pre-MVVM-rewrite) room list, kept on life support as
 * an opt-in fallback behind the "Use Old Room List" labs flag (see ../settings/Settings.tsx's own
 * Haven.useOldRoomList) now that upstream has deleted it outright.
 *
 * Everything this subsystem needs lives under this one directory so it can be identified/removed
 * as a single unit later. External code should only ever import from this barrel file, never reach
 * into legacy-room-list/components or legacy-room-list/stores directly - that's what keeps the
 * "one directory, one build flag" boundary meaningful. See webpack.config.ts's own
 * HAVEN_INCLUDE_OLD_ROOM_LIST handling and legacy-room-list-stub/index.ts, this module's
 * build-flag-off counterpart (must keep the same exported surface as this file).
 */

export { default as LegacyRoomList, TAG_ORDER } from "./components/LegacyRoomList";
export { default as LegacyRoomListHeader } from "./components/LegacyRoomListHeader";
export { default as LegacyRoomSearch } from "./components/RoomSearch";
export { default as LegacyRoomBreadcrumbs } from "./components/RoomBreadcrumbs";
export { HEADER_HEIGHT as LEGACY_ROOM_LIST_HEADER_HEIGHT } from "./components/RoomSublist";
export { default as LegacyRoomListStore, LISTS_UPDATE_EVENT as LEGACY_ROOM_LIST_LISTS_UPDATE_EVENT } from "./stores/RoomListStore";
export {
    default as CollapseDistributor,
    type ICollapseConfig,
    CollapseItem,
} from "./resizer/collapse";
export { BackdropPanel } from "./components/BackdropPanel";

/** True in this (the real) module; the stub counterpart sets this to false, so callers can tell
 *  at runtime whether the legacy room list was actually included in this build, regardless of
 *  what the labs flag says - see webpack.config.ts's own doc for why the flag alone isn't enough. */
export const LEGACY_ROOM_LIST_AVAILABLE = true;
