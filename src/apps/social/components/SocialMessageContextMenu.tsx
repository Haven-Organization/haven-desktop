/*
 * Social Overlay — SocialMessageContextMenu
 *
 * Adds one developer-mode-only item ("View in room" - opens the event in its stock Element room
 * view, bypassing Social's own matrix.to/permalink routing entirely since this is a plain
 * Action.ViewRoom dispatch, not a link click) to the same "..." menu Social's post tiles already
 * show. MessageContextMenu itself is a sealed stock component - no children/extra-items prop, and
 * its own render() hardcodes its own four IconizedContextMenuOptionList sections - so there's no
 * prop-based way to add to it. A first attempt rendered a second, separately-positioned
 * IconizedContextMenu instead; the user rejected that on sight (it read as an obviously bolted-on,
 * disjointed floating box, not part of the same dropdown). This extends the class instead and
 * overrides just render(), calling super.render() for everything else and surgically appending our
 * own item to the existing commonItemsList's own IconizedContextMenuOptionList - genuinely inside
 * the same popup, not a second one.
 */

import React, { type JSX } from "react";
import { VisibilityOnIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import MessageContextMenu from "../../../../element-web/apps/web/src/components/views/context_menus/MessageContextMenu";
import { IconizedContextMenuOption } from "../../../../element-web/apps/web/src/components/views/context_menus/IconizedContextMenu";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import { _t } from "../../../../element-web/apps/web/src/languageHandler";

export default class SocialMessageContextMenu extends MessageContextMenu {
    private onViewInStockRoomClick = (): void => {
        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            event_id: this.props.mxEvent.getId(),
            highlighted: true,
            room_id: this.props.mxEvent.getRoomId(),
            metricsTrigger: undefined,
        });
        this.props.onFinished();
    };

    public render(): React.ReactNode {
        const original = super.render() as React.ReactElement<{ children: React.ReactNode }>;
        if (!SettingsStore.getValue("developerMode")) return original;

        const extraOption = (
            <IconizedContextMenuOption
                key="social-view-in-stock-room"
                icon={<VisibilityOnIcon />}
                label={_t("timeline|mab|view_in_room")}
                onClick={this.onViewInStockRoomClick}
            />
        );

        const [menuElement, ...rest] = React.Children.toArray(original.props.children) as React.ReactElement<{
            children: React.ReactNode;
        }>[];
        const sections = React.Children.toArray(menuElement.props.children);
        // commonItemsList (Forward/Permalink/Report/View source/etc.) is the last non-empty section
        // before redactItemList (Remove, styled red) if present - inserting here rather than as a
        // brand new list keeps this in the same visual group as View source, matching the plain
        // "Forward Share Report Source URL View source" grouping this is meant to sit alongside,
        // instead of opening its own new divider-separated section.
        const lastIndex = sections.length - 1;
        const isLastRedact = (sections[lastIndex] as JSX.Element)?.props?.red === true;
        const targetIndex = isLastRedact ? lastIndex - 1 : lastIndex;
        const target = sections[targetIndex] as React.ReactElement<{ children: React.ReactNode }>;
        const targetChildren = React.Children.toArray(target.props.children);
        // View source should always be the last item in this section - inserting right before it
        // (identified by its own stock label, since these are otherwise indistinguishable
        // IconizedContextMenuOption elements) rather than just appending at the very end, which
        // would put this after it instead.
        const viewSourceIndex = targetChildren.findIndex(
            (child) => (child as JSX.Element)?.props?.label === _t("timeline|context_menu|view_source"),
        );
        const insertAt = viewSourceIndex === -1 ? targetChildren.length : viewSourceIndex;
        const newTargetChildren = [
            ...targetChildren.slice(0, insertAt),
            extraOption,
            ...targetChildren.slice(insertAt),
        ];
        const newTarget = React.cloneElement(target, {}, ...newTargetChildren);
        const newSections = [...sections];
        newSections[targetIndex] = newTarget;

        const newMenuElement = React.cloneElement(menuElement, {}, ...newSections);
        return React.cloneElement(original, {}, newMenuElement, ...rest);
    }
}
