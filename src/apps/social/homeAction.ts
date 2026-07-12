/**
 * Kept in its own file, separate from SocialHomeView.tsx, so app.ts can reference this constant
 * eagerly (needed at boot, in MatrixChat/LoggedInView/SpacePanel) without pulling in the whole
 * SocialHomeView component tree — that stays lazy-loaded, see app.ts.
 */
export const SOCIAL_HOME_ACTION = "view_social_home";
