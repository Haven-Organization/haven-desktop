import { lazy } from "react";
import { PublicIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type HavenApp } from "../framework/types";
import { SOCIAL_HOME_ACTION } from "./homeAction";
import socialIcon from "./assets/social-icon.png";

export const socialApp: HavenApp = {
    id: "social",
    name: "Social",
    Icon: PublicIcon,
    image: socialIcon,
    homeAction: SOCIAL_HOME_ACTION,
    // Lazy: this app's registration (id/name/icon/homeAction) is imported eagerly at boot from
    // several core files (MatrixChat, LoggedInView, SpacePanel, UserMenu); the actual view — and
    // everything it transitively pulls in — should only load once the app is actually opened.
    Component: lazy(() => import("./views/SocialHomeView").then((m) => ({ default: m.SocialHomeView }))),
};
