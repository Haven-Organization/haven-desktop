/*
 * Haven: build-flag-off counterpart to ../legacy-room-list/index.ts - webpack.config.ts aliases
 * the "legacy-room-list" import specifier to THIS module instead of the real one whenever
 * HAVEN_INCLUDE_OLD_ROOM_LIST is unset, so the real ~40-file subsystem never gets bundled at all.
 *
 * Must keep the same exported names as the real module. Every value here is either unreachable
 * (LEGACY_ROOM_LIST_AVAILABLE is false, so callers should never actually render/use the rest) or
 * throws loudly if something slips past that check anyway - deliberately not a silent no-op, so a
 * bug that bypasses the availability check fails fast instead of rendering a confusing blank panel.
 */

import React from "react";

function unavailable(): never {
    throw new Error(
        "Old room list was not included in this build (HAVEN_INCLUDE_OLD_ROOM_LIST was unset " +
            "at build time) - check LEGACY_ROOM_LIST_AVAILABLE before rendering/using this.",
    );
}

class LegacyRoomListStub extends React.Component<Record<string, unknown>> {
    public focus(): void {
        unavailable();
    }

    public render(): React.ReactNode {
        unavailable();
    }
}

export const LegacyRoomList = LegacyRoomListStub;
export const TAG_ORDER: string[] = [];

export const LegacyRoomListHeader: React.FC<Record<string, unknown>> = () => unavailable();
export const LegacyRoomSearch: React.FC<Record<string, unknown>> = () => unavailable();
export const LegacyRoomBreadcrumbs: React.FC<Record<string, unknown>> = () => unavailable();

export const LEGACY_ROOM_LIST_HEADER_HEIGHT = 0;

export const LEGACY_ROOM_LIST_LISTS_UPDATE_EVENT = "legacy-room-list-unavailable";
export const LegacyRoomListStore = {
    get instance(): never {
        return unavailable();
    },
};

export const LEGACY_ROOM_LIST_AVAILABLE = false;

export class CollapseDistributor {
    public static createItem(): never {
        return unavailable();
    }
}
export interface ICollapseConfig {
    onCollapsed?: (collapsed: boolean) => void;
    [key: string]: unknown;
}
export class CollapseItem {}

export const BackdropPanel: React.FC<Record<string, unknown>> = () => null;
