# Architecture

## How this repository is put together

- `element-web/` is the submodule: a plain, unmodified checkout of upstream Element Web.
- `patches/haven-code.patch` is a single patch containing every code change Haven makes to stock
  files.
- `patches/branding/` holds the handful of image assets Haven replaces (background, logo, app
  icons), copied straight over rather than diffed, since diffing binary files doesn't make much
  sense.
- `src/apps/` is Haven's own code: the apps framework itself plus each individual app (Social
  today, more later). None of this touches the submodule; it's referenced from the patched files
  by relative path.
- `scripts/setup.sh` ties the three together: fetch the submodule, apply the patch, copy the
  branding, install dependencies.

## Keeping up to date

`patches/haven-code.patch` is generated against a specific commit of `element-web`. When the
submodule is bumped to a newer release, re-check that the patch still applies cleanly
(`git apply --check patches/haven-code.patch` from inside `element-web/`) and fix up anything that
no longer matches before committing the bump.

## Patch strategy

`element-web/` stays as close to stock upstream as possible. All Haven-specific code lives
under `src/apps/`. Only a small, fixed set of upstream files are patched to hook the apps
framework in:

- `element-web/apps/web/src/components/structures/MatrixChat.tsx` — routes the generic
  `view_app` navigation action to whichever app is active.
- `element-web/apps/web/src/components/structures/LoggedInView.tsx` — renders the active app's
  root view full-width in place of the room list + room view, mirroring how it renders rooms.
- `element-web/apps/web/src/components/views/spaces/SpacePanel.tsx` — renders pinned app buttons
  and the currently-open app's button in the space bar; mounts the apps section of `UserMenu`.
- `element-web/packages/shared-components/src/menus/UserMenu/UserMenu.tsx` and its view model —
  render the "Apps" section between the account profile block and "Link new device".
- Theme `.pcss` files — import `src/apps/*/styles/*.scss`.

Every patched file marks its edits with a `// <app> patch` comment so upstream merges/rebases
are easy to re-apply.

## Apps framework (`src/apps/`)

Each app registers itself (id, display name, icon, the navigation action it responds to, and its
root view component) into a shared registry. Social (`src/apps/social/`) is the first app built
against this interface — see its own code for the concrete example.

Pinning: right-clicking an app in the UserMenu's apps list opens the same `IconizedContextMenu`
style used for right-clicking a space, with a pin/unpin toggle. Pinned state is stored in Matrix
account data (mirroring how `m.widgets` is used elsewhere in element-web) so it syncs across
devices and survives restarts — pinned apps' buttons appear in the space bar on every startup,
not just while open.
