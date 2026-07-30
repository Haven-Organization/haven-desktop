import { lazy } from "react";
import { PublicIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type HavenApp } from "../framework/types";
import { SOCIAL_HOME_ACTION } from "./homeAction";
import socialIcon from "./assets/social-icon.png";

// Lazy: this app's registration (id/name/icon/homeAction) is imported eagerly at boot from
// several core files (MatrixChat, LoggedInView, SpacePanel, UserMenu); the actual view — and
// everything it transitively pulls in — should only load once the app is actually opened.
// Declared standalone (not inlined into socialApp below) so lazy()'s own generic infers directly
// from the callback rather than against socialApp.Component's broader ComponentType field type.
const Component = lazy(() => import("./views/SocialHomeView").then((m) => ({ default: m.SocialHomeView })));

// Same reasoning as Component above - only loads once the user settings dialog's Apps tab is
// actually opened and this app's own Settings button clicked (see AppsUserSettingsTab.tsx).
const SettingsComponent = lazy(() =>
    import("./views/SocialSettingsTab").then((m) => ({ default: m.SocialSettingsTab })),
);

export const socialApp: HavenApp = {
    id: "social",
    name: "Social",
    Icon: PublicIcon,
    image: socialIcon,
    homeAction: SOCIAL_HOME_ACTION,
    Component,
    SettingsComponent,
};
