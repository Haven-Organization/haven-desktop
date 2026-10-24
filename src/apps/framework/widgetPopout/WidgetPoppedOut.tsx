/*
 * Haven - what a widget's tile shows while the widget is popped out into its own window.
 * See WidgetPopoutStore.ts.
 */

import React, { type JSX } from "react";
import { PopOutIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import Modal from "../../../../element-web/apps/web/src/Modal";
import InfoDialog from "../../../../element-web/apps/web/src/components/views/dialogs/InfoDialog";

interface Props {
    onShowWindow: () => void;
    onBringBack: () => void;
}

export function WidgetPoppedOut({ onShowWindow, onBringBack }: Props): JSX.Element {
    return (
        <div className="haven_WidgetPoppedOut">
            <PopOutIcon className="haven_WidgetPoppedOut_icon" aria-hidden />
            <p>This widget is open in its own window.</p>
            <div className="haven_WidgetPoppedOut_buttons">
                <AccessibleButton kind="primary_sm" onClick={onShowWindow}>
                    Show window
                </AccessibleButton>
                <AccessibleButton kind="link_sm" onClick={onBringBack}>
                    Bring back here
                </AccessibleButton>
            </div>
        </div>
    );
}

/**
 * Says why nothing happened when the pop-out window was refused and the widget was already
 * maximized, the fallback otherwise used.
 */
export function showPopoutRefusedDialog(): void {
    Modal.createDialog(InfoDialog, {
        title: "Couldn't open a separate window",
        description: (
            <p>
                Haven wasn't allowed to open the widget in a window of its own. A browser's popup blocker can stop it,
                and so can a desktop app that sends every new window to the web browser. Allow popups for Haven to use
                pop-out, or keep using the widget here.
            </p>
        ),
    });
}
