# Architecture

## How this repository is put together

Haven is a real fork, not a patch set on top of a pinned dependency. `element-web/` is a normal
part of this repository's own git history — Haven's commits sit directly on top of upstream
Element Web's commits, in the same tree, the same way any fork on GitHub works. There is no git
submodule and no `patches/` directory; editing a file under `element-web/` is exactly like editing
any other file in this repo.

Top-level layout:

- `element-web/` — the full upstream Element Web tree (`apps/web`, `apps/desktop`,
  `packages/shared-components`, etc.), edited directly where Haven needs to hook in or fix
  something.
- `src/apps/` — Haven's own code, entirely outside `element-web/`. `src/apps/framework/` is the
  generic apps-plugin machinery; `src/apps/social/` is the Social app itself (currently the only
  app built on it). Nothing under `src/apps/` is upstream code.
- `docs/` — this file, plus `building.md` (build/package commands) and `configure.md`
  (`config.json` options Haven adds).
- `scripts/setup.sh` — installs dependencies and optionally reverts Haven's branding back to
  stock (see the script's own comments for the `HAVEN_NO_BRANDING`/`HAVEN_LOGIN_BACKGROUND`/
  `HAVEN_NOTIFICATION_SOUND` environment variables).
- `assets/`, `screenshots/` — README/marketing images, not shipped in any build.
- `README.md`, `LICENSE`, `HAVEN_VERSION` — Haven's own, describing Haven as a whole (not
  `element-web`'s own README/LICENSE, which stay inside that directory and remain accurate for
  the code under it).

## Touching upstream code

Most of what Haven adds lives entirely under `src/apps/`, imported by relative path from wherever
it's needed — adding a feature that doesn't need to change Element's own existing behavior usually
means writing a new file there and nothing else.

A smaller set of upstream files under `element-web/` are directly edited, where a Haven feature
needs to hook into something Element's own code owns: routing a Social deep link, rendering the
apps section of the space bar and UserMenu, adding a room banner to the settings/right-panel/room
header, exporting a previously-private component so an app can reuse it, and similar. Every such
edit is marked with a `// haven apps-framework patch` (or `// haven patch`, for something more
one-off) comment at the point of change — a plain code comment, not an actual patch file. Its job
is to make Haven's edits visually distinguishable from upstream's own code when reading a file, and
to make merging in new upstream commits easier: a conflict on a marked line is expected and means
"reconcile Haven's hook with whatever upstream changed here"; a conflict anywhere else is a sign
Haven touched something it didn't mean to.

To see the current, live list of every upstream file Haven touches, don't rely on a list in this
doc (it will drift) — ask git directly:

```
grep -rl "haven apps-framework patch\|haven patch" element-web/ --include="*.ts" --include="*.tsx" --include="*.pcss"
```

As of this writing that list spans routing (`vector/routing.ts`), the main layout components
(`MatrixChat.tsx`, `LoggedInView.tsx`, `SpacePanel.tsx`, `LeftPanel.tsx`), the shared-components
`UserMenu` and its view model, a handful of settings tabs and dialogs (room settings, join rules,
devtools, bridge settings), theme `.pcss` files (each imports `src/apps/*/styles/*.scss`), and the
desktop Electron builder config. New apps will likely add to this list; that's expected and fine —
keep marking edits with the same comment convention rather than letting them blend in silently.

## Keeping up to date with upstream

Because `element-web/` is real git history rather than a pinned submodule checkout, pulling in new
upstream Element Web commits is a normal git merge, not a patch-regeneration step:

```
git fetch origin        # origin = https://github.com/element-hq/element-web
git merge origin/develop # or a specific release tag
```

Conflicts will surface on whatever lines the comment markers above flag as Haven's own — resolve
those by hand, keeping Haven's hook while taking upstream's surrounding change. A conflict-free
merge on a marked file is worth a second look; it usually means upstream moved the code Haven hooks
into somewhere the merge didn't notice, not that nothing needs attention.

## Apps framework (`src/apps/framework/`)

An app is a plain object conforming to the `HavenApp` interface (`types.ts`): a stable `id`, a
display `name`, an `Icon` (and optionally a custom `image`, for real branding instead of a generic
icon), a `homeAction` (the dispatcher action string that opens the app and becomes the `MatrixChat`
`page_type` while it's active), and a `Component` — the root view rendered full-width in place of
the room list + room view while the app is open.

`registry.ts` holds every registered app (`ALL_HAVEN_APPS`) and filters it through
`config.ts`'s `isAppEnabled()` (the `haven.apps` block in `config.json` — see `docs/configure.md`)
to produce `getEnabledApps()`/`getApp()`/`getAppByHomeAction()`. Adding a new app means adding one
entry to `ALL_HAVEN_APPS`; the layout components above look an app up generically by its
`homeAction`, not through a per-app `case`, so nothing else needs to change to wire it in.

Keep an app's registration lightweight: `homeAction` should live in its own tiny file (see
`src/apps/social/homeAction.ts`), separate from the app's actual view tree, so the registry can be
imported eagerly at boot without pulling in the whole app. `Component` should be `React.lazy(...)`,
rendered inside a `<Suspense>` by `LoggedInView.tsx`.

Pinning: right-clicking an app in the UserMenu's apps list opens a pin/unpin toggle (same
`IconizedContextMenu` style as right-clicking a Space). Pinned state is account data
(`software.haven.pinned_apps`, `pinnedApps.ts`), following the same clone-mutate-write +
echo-wait pattern Element itself uses for `m.widgets` — pins sync across devices and persist across
restarts. Pinned apps' buttons always show in the space bar; the currently-open app's button also
shows there even if unpinned, for the duration it's open.

## Building

See `docs/building.md` for the actual build/dev-server/packaging commands — this file only covers
how the source is organized, not how to build it.
