/*
 * Haven - the window a part of the UI is drawn in, for code that opens menus and other popups.
 *
 * null means Haven's main window. An app popped out into its own window (AppPopoutHost.tsx) is
 * still part of the main window's React tree, so without this, popups it opens would go into the
 * main window's page and be placed by the main window's size.
 */

import { createContext } from "react";

export const PortalWindowContext = createContext<Window | null>(null);
