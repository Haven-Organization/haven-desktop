/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import {
    BaseViewModel,
    type LeftResizablePanelViewActions,
    type SeparatorViewActions,
    type PanelSize,
    type PanelImperativeHandle,
    type GroupViewActions,
    type ResizerViewSnapshot,
} from "@element-hq/web-shared-components";
import { debounce } from "lodash";

import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";

function getInitialState(): ResizerViewSnapshot {
    if (SettingsStore.getValue("RoomList.isPanelCollapsed")) {
        return {
            isCollapsed: true,
            initialSize: 0,
        };
    }
    return {
        isCollapsed: false,
        initialSize: SettingsStore.getValue("RoomList.panelSize") ?? undefined,
    };
}

/**
 * Viewmodel that drives the resizable left panel.
 */
export class ResizerViewModel
    extends BaseViewModel<ResizerViewSnapshot, void>
    implements SeparatorViewActions, LeftResizablePanelViewActions, GroupViewActions
{
    /**
     * This object gives us access to the API methods of react-resizable-panels library.
     */
    private panelHandle?: PanelImperativeHandle;

    /**
     * Needed to distinguish between a drag and a click on the separator.
     */
    private readonly mouseClickHandler: MouseClickHandler;

    public constructor() {
        super(undefined, getInitialState());
        // Run onSeparatorClick when the separator is clicked.
        this.mouseClickHandler = new MouseClickHandler(this.onSeparatorClick);
    }

    public onLeftPanelResize = debounce((panelSize: PanelSize): void => {
        const newSize = panelSize.inPixels;
        this.snapshot.merge({ isCollapsed: newSize === 0 });
    }, 50);

    public onLeftPanelResized = (newSize: number): void => {
        // Round to the nearest whole percent for storage, but always persist *something* - don't
        // early-return and wait for a follow-up call to land on a clean integer. `newSize` is
        // fractional whenever the drag lands at the panel's min/max pixel constraint (props
        // minSize="200px"/maxSize="370px" below) - react-resizable-panels reports whatever
        // fractional flex-grow value produces that clamped pixel width, not a clean percentage, and
        // it stays fractional no matter how many times it's re-resized since the same constraint
        // re-clamps it right back. A previous version of this function called
        // `panelHandle?.resize()` and returned without persisting in that case, hoping a follow-up
        // onLeftPanelResized call would arrive with a rounded integer - at a hard constraint, that
        // call never comes, so dragging to the minimum silently never persisted anything at all: the
        // panel visibly sat at 200px all session while the stored setting kept whatever value was
        // last persisted before that drag - confirmed live 2026-07-21 (dragged to the 200px minimum,
        // setting stayed frozen at an old 39% from an earlier resize) - so returning from an app
        // (which remounts the panel fresh from the stored setting) visibly snapped the width back to
        // that stale value. Rounding for storage doesn't even guarantee an integer *pixel* width
        // anyway (percentage × container width is still usually fractional), so the original
        // rounding's own goal wasn't reliably achieved either - not worth the risk of never
        // persisting at all.
        const roundedSize = Math.round(newSize);

        const isCollapsed = roundedSize === 0;
        // Store the size if the panel isn't collapsed.
        if (!isCollapsed) {
            SettingsStore.setValue("RoomList.panelSize", null, SettingLevel.DEVICE, roundedSize);
            // Haven: also keep the live snapshot's initialSize in sync, not just the persisted
            // setting - getInitialState() only ever runs once, at construction, so without this the
            // in-memory value stays frozen at whatever it was on app boot for the rest of the
            // session. LeftResizablePanelView (and so react-resizable-panels' own defaultSize) reads
            // this fresh on every mount, and this VM instance is cached/reused across navigation -
            // entering and leaving an app (isAppMode) unmounts and remounts the panel entirely, so a
            // stale initialSize here visibly "resets" the room list back to whatever size it was at
            // boot, silently discarding any resize made since, even though SettingsStore itself
            // already had the right value the whole time.
            this.snapshot.merge({ initialSize: roundedSize });
        }
        // Store whether the panel was collapsed.
        // This is stored separately instead of being inferred from the stored panel size so that
        // the panel can be restored to its last known non-zero width even after app reload, which
        // we wouldn't be able to do if we stored panelSize as zero.
        SettingsStore.setValue("RoomList.isPanelCollapsed", null, SettingLevel.DEVICE, isCollapsed);
    };

    public setPanelHandle = (handle: PanelImperativeHandle): void => {
        this.panelHandle = handle;
    };

    private onSeparatorClick = (): void => {
        // When panel is collapsed, single click should expand the panel.
        if (this.panelHandle?.isCollapsed()) {
            const lastSize = SettingsStore.getValue("RoomList.panelSize");
            this.panelHandle.resize(`${lastSize ?? 100}%`);
        }
    };

    public onDoubleClick = (): void => {
        // When the panel is expanded, double click should collapse.
        if (!this.panelHandle?.isCollapsed()) this.panelHandle?.collapse();
    };

    public onPointerUp = (): void => {
        this.mouseClickHandler.onPointerUp();
    };

    public onPointerMove = (): void => {
        this.mouseClickHandler.onPointerMove();
    };

    public onPointerDown = (): void => {
        this.mouseClickHandler.onPointerDown();
    };
}

/**
 * Dragging the separator will emit a click event.
 * This class uses pointer event handlers to distinguish between a drag and a click
 * on the separator.
 */
class MouseClickHandler {
    public constructor(private readonly onClick: () => void) {}

    private isResize = false;

    public onPointerUp = (): void => {
        if (!this.isResize) this.onClick();
    };

    public onPointerDown = (): void => {
        this.isResize = false;
    };

    public onPointerMove = (): void => {
        this.isResize = true;
    };
}
