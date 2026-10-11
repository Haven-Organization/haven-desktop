/*
 * Social Overlay - socialScreen
 *
 * The one way Social's pages write their own URL - see pendingSocialScreen.ts for why a plain
 * onNewScreen call from each page isn't enough.
 */

import { onNewScreen } from "../../../../element-web/apps/web/src/vector/routing";
import { clearPendingSocialScreen, peekPendingSocialScreen } from "./pendingSocialScreen";

/**
 * Sets the URL bar to `screen`, unless Social is still on its way to an explicit destination and
 * this isn't it - an intermediate page's URL would only add a history entry the user never visited.
 * Writing the destination itself ends that state.
 */
export function writeSocialScreen(screen: string): void {
    const pendingScreen = peekPendingSocialScreen();
    if (pendingScreen !== null) {
        if (screen !== pendingScreen) return;
        clearPendingSocialScreen();
    }
    onNewScreen(screen);
}
