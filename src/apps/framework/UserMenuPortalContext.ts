/*
 * Haven apps framework — UserMenuPortalContext
 *
 * When the spaces bar is hidden (Haven.showSpacesBar), SpacePanel.tsx portals the relocated
 * UserMenu into whichever DOM node currently "claims" this slot — normally LeftPanel's own search
 * bar row. But LeftPanel (and its portal target) is unmounted entirely while a Haven app (e.g.
 * Social) is open, since the app's own content fills that whole area — leaving no target, so
 * SpacePanel fell back to rendering the menu inline inside the still-collapsed (zero-width, hidden)
 * space panel, i.e. invisible. That meant no way back to Home/normal rooms once inside an app with
 * the spaces bar off.
 *
 * This context lets whichever surface is actually mounted (LeftPanel outside apps, or an app's own
 * top area inside one) register itself as the current target via the same callback-ref pattern —
 * provided high enough (LoggedInView) that it reaches pageElement too, even though pageElement is
 * constructed elsewhere and merely rendered within LoggedInView's own tree.
 */

import { createContext, useContext } from "react";

export type SetUserMenuPortalTarget = (node: HTMLDivElement | null) => void;

const noop: SetUserMenuPortalTarget = () => {};

export const UserMenuPortalContext = createContext<SetUserMenuPortalTarget>(noop);

export function useSetUserMenuPortalTarget(): SetUserMenuPortalTarget {
    return useContext(UserMenuPortalContext);
}
