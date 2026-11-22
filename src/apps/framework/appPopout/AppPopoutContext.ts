/*
 * Haven - true inside an app drawn into its pop-out window (see AppPopoutStore.ts).
 * Kept apart from AppPopoutHost.tsx so apps can read it without importing the app registry.
 */

import { createContext } from "react";

export const AppPopoutContext = createContext(false);
