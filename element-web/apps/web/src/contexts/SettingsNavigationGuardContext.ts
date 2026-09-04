/*
 * Haven: lets a settings tab nested arbitrarily deep in a settings dialog (currently only
 * PackEditor.tsx, for MSC2545 image packs) block navigation - the in-page Back button, switching
 * to another sidebar category, and the dialog's own close (its X button, Escape, and clicking
 * outside it) - while it has unsaved changes, without RoomSettingsDialog/UserSettingsDialog
 * needing to know anything about what's nested inside their tabs.
 *
 * The tab registers a guard while dirty and clears it once saved/discarded/unmounted. Sidebar tab
 * switching (an in-tree action) calls the guard directly. The dialog's own close is different: it
 * can happen from *outside* the React tree entirely (clicking the modal background is handled by
 * ModalManager itself, calling `modal.close()` directly rather than the `onFinished` prop - see
 * Modal.tsx's own `onBackgroundClick`), so it can only be intercepted via `Modal.createDialog`'s
 * `onBeforeClose` option, which is registered once, before the dialog even mounts. `navigationGuardRef`
 * bridges that gap: the caller creates one and passes it into `onBeforeClose`, the dialog keeps it
 * in sync with whatever guard is currently registered via this context, and `onBeforeClose` reads
 * it live at close time - see DialogOpener.ts's and MatrixChat.tsx's own `open_room_settings`/
 * `Action.ViewUserSettings` handlers for both ends of this wiring.
 */

import { createContext, useContext } from "react";

/** Resolves true if the navigation/close should proceed, false if it should be held. */
export type NavigationGuard = () => Promise<boolean>;

/** A stable box a guard can be read out of after the dialog owning it has already been created. */
export interface NavigationGuardRef {
    current: NavigationGuard | null;
}

export interface SettingsNavigationGuardContextValue {
    setGuard: (guard: NavigationGuard | null) => void;
}

export const SettingsNavigationGuardContext = createContext<SettingsNavigationGuardContextValue>({
    setGuard: () => {},
});

export function useSettingsNavigationGuard(): SettingsNavigationGuardContextValue {
    return useContext(SettingsNavigationGuardContext);
}

/** Shared by RoomSettingsDialog/UserSettingsDialog: the `onBeforeClose` a caller should pass to
 *  `Modal.createDialog` alongside a `navigationGuardRef` prop threaded into the dialog component. */
export function guardedBeforeClose(navigationGuardRef: NavigationGuardRef): () => Promise<boolean> {
    return async () => {
        if (!navigationGuardRef.current) return true;
        return navigationGuardRef.current();
    };
}
