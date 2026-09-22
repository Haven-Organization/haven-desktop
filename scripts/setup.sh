#!/usr/bin/env bash
# Installs dependencies for Haven. Safe to run more than once.
#
# Usage: ./scripts/setup.sh
#
# Set HAVEN_NO_BRANDING=1 to revert to stock Element's own logos/icons/background instead of
# Haven's - e.g. for a build that shouldn't carry Haven's visual identity at all. Deliberately not
# a config.json option: that would mean always packaging both asset sets in every build just for a
# rarely-used switch, instead of a build simply having the one it was built with.
# This only covers the web app's image assets; for the desktop app's own name/appId/protocols, pass
# VARIANT_PATH=element.io/release/build.json to `pnpm build` in apps/desktop instead of the
# (Haven-branded) default variant.
#
# Set HAVEN_LOGIN_BACKGROUND=/path/to/image to bake in a custom login screen background instead of
# Haven's own, replacing the file directly (works whichever of the two branding modes above was
# chosen). Applies on top of either branding mode. Note this one's genuinely optional to do at
# build time at all - config.json's own stock "branding.welcome_background_url" field already
# accepts any URL, including one hosted elsewhere entirely, with no build changes needed; use this
# only if you'd rather bake the image into the build itself instead of depending on
# config.json/external hosting.
#
# Set HAVEN_NOTIFICATION_SOUND=/path/to/sound.mp3 (and optionally
# HAVEN_NOTIFICATION_SOUND_OGG=/path/to/sound.ogg) to bake in a custom default notification sound,
# replacing the one played when nobody's set their own custom sound (see Settings > Notifications -
# this is the fallback below that, for everyone who hasn't touched that setting at all). If only
# the .mp3 is given, the stock .ogg is left in place as a fallback for the rare browser that can't
# play mp3 - it'll hear the stock sound instead of the custom one in that one case, rather than
# nothing at all.
#
# There's no build-time option for the login/register footer links (customizing or removing them
# entirely) - config.json's own stock "branding.auth_footer_links" already does exactly that at
# runtime (set it to [] to remove them, or your own list to replace Haven's default) with no build
# involvement needed, and it's plain text with no packaging-size concern, unlike the two above.
#
# Unlike HAVEN_NO_BRANDING, HAVEN_LOGIN_BACKGROUND/HAVEN_NOTIFICATION_SOUND aren't meant to be
# hidden - a host running their own build is expected to reach for them.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELEMENT_WEB_DIR="$ROOT_DIR/element-web"

# The commit that first replaced Element's stock branding with Haven's own. HAVEN_NO_BRANDING
# reverts every file that commit touched back to its pre-branding content, using real git history
# instead of a separate patch/asset-copy step now that Haven's code lives directly in this repo. If
# branding is touched again in a later commit, that commit's own changes obviously won't be covered
# by this revert - update BRANDING_COMMIT (or switch to a range) if that happens.
#
# For a TEXT file, "revert to pre-branding content" means reverse-applying just this commit's own
# diff for that path (see the loop below) - not restoring the whole file to its BRANDING_COMMIT^
# snapshot. A whole-file restore brings back everything else in the file as it was back then too,
# which for a file that keeps evolving is almost never what's wanted: confirmed live 2026-09-21,
# webpack.config.ts's BRANDING_COMMIT^ content still imported "./components.json" and referenced the
# legacy Module/Customisation API, both removed by upstream since - restoring the whole file broke
# the unbranded build outright ("Unable to load 'webpack.config.ts'", since that stale import chain
# no longer resolves). The same whole-file-staleness problem had already forced three earlier
# one-off patches to this file alone (the resolve.alias/legacy-room-list fix, the .svg?react loader
# shape fix, the postcss-easings import removal - all in this script's own prior history) before
# finally breaking hard enough to be caught here instead of shipping silently broken. Reverting only
# the actual branding lines, via a real patch, can't reintroduce content upstream has since deleted
# elsewhere in the same file - it never touches those lines in the first place - so this eliminates
# the whole bug class rather than fixing the latest instance of it, and all three of those one-off
# patches are gone now (nothing left for them to counteract).
BRANDING_COMMIT="e92aa1bd70d07a9e9ffba574bf21ee637d57faaf"

# BRANDING_COMMIT bundled in a couple of non-branding fixes alongside the actual rebrand, which
# HAVEN_NO_BRANDING's blanket per-file revert would otherwise silently undo too:
#
# - Every theme's own top-level .pcss file: each one's *entire* diff in that commit is just the
#   two @import lines wiring apps-framework.scss/social-overlay.scss in (confirmed via
#   `git show BRANDING_COMMIT -- <path>` for each one below, nothing else) - reverting "branding"
#   should never mean Social's own CSS silently stops loading (e.g. a profile room's own Settings
#   dialog reaches BannerSetting.tsx regardless of whether the Social app/nav itself is reachable,
#   and it renders completely unstyled - unbounded image, no crop - without this CSS).
# - AuthFooter.tsx: the pre-branding version renders "Powered by Matrix" as a hardcoded fixture
#   *after* the configurable auth_footer_links array, unconditionally, regardless of what that
#   array is set to - so setting auth_footer_links: [] (its own documented purpose - see this
#   file's own comment above - "remove them entirely") left that one link behind regardless. The
#   Haven-patched version folds it into the same array instead, so an explicit [] genuinely means
#   zero links. Both of glowers' own config files (config_element.json and config_haven.json) set
#   auth_footer_links explicitly, so the file's own default *branding-text* fallback (Haven's own
#   GitHub org link vs. stock's Blog/Mastodon/GitHub) is never actually reachable in a real deploy
#   either way - excluding the whole file costs nothing in practice and fixes the actual bug.
# - package.sh: the pre-branding form's version scheme is `git describe --dirty --tags` with no tag
#   filter, run from this unified repo's own root rather than a separate element-web/.git checkout.
#   Since Haven's own release tags (haven-vX.Y.Z) live in this same repo and this build's tree is
#   always dirty during the revert itself (files are checked out, not committed), that produced
#   "haven-vX.Y.Z-dirty" - still showing Haven's own name (the opposite of NO_BRANDING's intent)
#   while also looking like a broken dev build. User confirmed 2026-08-18 (cutting 0.6.5) they'd
#   rather glowers element just show the same informative "haven-vX.Y.Z+element-vA.B.C-N-gHASH"
#   string every other build gets than try to hide "haven" from a Settings > Help string that isn't
#   really user-facing branding the way logos/icons are - so package.sh no longer reverts at all.
# - SdkConfig.ts: upstream dropped the `DEFAULTS: DeepReadonly<IConfigOptions>` type annotation in
#   d4f72dfa69 ("Start consolidating shared types in the monorepo"), a type-only refactor unrelated
#   to branding, merged into this fork well after BRANDING_COMMIT was made against an older upstream
#   tree that still had it. That puts current develop's own line and BRANDING_COMMIT's own diff
#   context on a permanent collision course: reverse-applying the branding diff here always produces
#   a real 3-way conflict (confirmed live 2026-09-21), forever, since neither side is going to move
#   again on its own. A one-time hand resolution wouldn't stay resolved - the same conflict reappears
#   on the very next unbranded build - so this file gets the same kind of direct, targeted patch as
#   electron-builder.ts's AppImage line below instead of going through the generic revert loop at all.
# - BackgroundAudio.ts: this file's *entire* diff in the branding commit is a real feature with
#   nothing cosmetic about it - `play()` gained an optional `maxDurationSeconds` that cuts off
#   playback early, added so a user-uploaded custom notification sound (unlike the bundled ones)
#   can't play indefinitely. Notifier.ts (a different file, untouched by BRANDING_COMMIT so never
#   reverted) calls `play()` with that third argument unconditionally - reverting this file back to
#   the old two-argument signature doesn't just lose the cap, it leaves Notifier.ts's own call site
#   passing an argument `play()` no longer accepts, which is a compile error, not a quiet regression
#   (confirmed live 2026-09-21, caught by the "Unbranded build stays buildable" CI step this same fix
#   added). Same reasoning as AppImage packaging below: a real, unrelated capability bundled into the
#   branding commit, kept for an unbranded build the same as a branded one.
#
# Excluded from the revert loop below rather than folded into BRANDING_COMMIT^'s content, so an
# unbranded build keeps these fixes; only the *visual identity* (logos/icons/backgrounds/copy)
# actually reverts.
BRANDING_REVERT_EXCLUDE=(
    "element-web/apps/web/res/themes/dark/css/dark.pcss"
    "element-web/apps/web/res/themes/dark-custom/css/dark-custom.pcss"
    "element-web/apps/web/res/themes/legacy-dark/css/legacy-dark.pcss"
    "element-web/apps/web/res/themes/legacy-light/css/legacy-light.pcss"
    "element-web/apps/web/res/themes/light/css/light.pcss"
    "element-web/apps/web/res/themes/light-custom/css/light-custom.pcss"
    "element-web/apps/web/res/themes/light-high-contrast/css/light-high-contrast.pcss"
    "element-web/apps/web/src/components/views/auth/AuthFooter.tsx"
    "element-web/apps/web/scripts/package.sh"
    "element-web/apps/web/src/SdkConfig.ts"
    "element-web/apps/web/src/audio/BackgroundAudio.ts"
)

if [ -n "${HAVEN_NO_BRANDING:-}" ]; then
    echo "==> HAVEN_NO_BRANDING set - reverting to stock Element branding"
    # Files the branding commit added (e.g. the Haven-specific desktop build variant) don't exist at
    # <parent> at all, so removing them outright is the correct "revert" for those - no diff to
    # reverse-apply, the file simply shouldn't exist. [ -e "$path" ] guards that removal so
    # re-running this against an already-reverted tree (e.g. building twice in a row without
    # switching branding back in between) doesn't fail trying to `git rm` a path that's already gone.
    #
    # For every other (modified) file: a binary asset (icon/logo/background/sound) has no text diff
    # to reverse-apply at all, and never changes again once Haven replaces it once, so reverting the
    # whole blob to its pre-branding content is exactly right - `git diff --numstat` reports "-" for
    # both counts on a binary file, which is what picks that path out below. A text file instead gets
    # `git show BRANDING_COMMIT -- <path> | git apply -R --3way` - reverse-applying just this commit's
    # own lines for that path as a 3-way merge, rather than restoring the whole file's BRANDING_COMMIT^
    # content (see this script's own comment above BRANDING_COMMIT for why). If upstream's own later
    # changes happen to touch the exact same lines Haven's branding did, `git apply` leaves real
    # conflict markers and exits non-zero, which this script's own `set -e` turns into a hard stop
    # instead of silently shipping a broken revert - resolve the conflict by hand if that ever happens.
    while IFS=$'\t' read -r status path; do
        skip=0
        for excluded_file in "${BRANDING_REVERT_EXCLUDE[@]}"; do
            [ "$path" = "$excluded_file" ] && skip=1 && break
        done
        [ "$skip" -eq 1 ] && continue
        case "$status" in
            A)
                [ -e "$ROOT_DIR/$path" ] && git -C "$ROOT_DIR" rm -q -f -- "$path"
                ;;
            *)
                added="$(git -C "$ROOT_DIR" diff --numstat "${BRANDING_COMMIT}^" "$BRANDING_COMMIT" -- "$path" | cut -f1)"
                if [ "$added" = "-" ]; then
                    git -C "$ROOT_DIR" checkout "${BRANDING_COMMIT}^" -- "$path"
                elif ! git -C "$ROOT_DIR" show "$BRANDING_COMMIT" -- "$path" | git -C "$ROOT_DIR" apply -R --3way; then
                    echo "HAVEN_NO_BRANDING: reverting '$path' conflicts with changes made to it since $BRANDING_COMMIT - resolve the <<<<<<< markers left in the file by hand" >&2
                    exit 1
                fi
                ;;
        esac
    done < <(git -C "$ROOT_DIR" diff --name-status "${BRANDING_COMMIT}^" "$BRANDING_COMMIT")

    # electron-builder.ts's own branding-commit diff bundled in a real, non-branding improvement
    # alongside the actual rebrand (its DEFAULT_VARIANT line) - AppImage packaging support, added in
    # the same commit. Reverse-applying that commit's diff undoes that too, same as it undoes the
    # variant path, since both are genuinely part of what that commit changed on this exact line;
    # unlike the webpack.config.ts staleness this script used to work around (see BRANDING_COMMIT's
    # own comment above), this one isn't a bug to fix so much as a choice - keep AppImage packaging
    # even in an unbranded build - patched back in here. This sed pattern matches text that's only
    # ever present right after the revert above ran, so it's a no-op otherwise (HAVEN_NO_BRANDING
    # unset, or this line changes shape again upstream).
    sed -i 's/target: \["tar.gz", "deb"\],/target: ["tar.gz", "deb", "AppImage"],/' \
        "$ROOT_DIR/element-web/apps/desktop/electron-builder.ts"

    # SdkConfig.ts (see this file's own exclusion above for why it's not in the revert loop): a
    # direct substitution of the three actual branding values, matching this file's current
    # (branded) content exactly so it's a no-op - not an error - if this file changes shape again.
    sed -i \
        -e 's/brand: "Haven",/brand: "Element",/' \
        -e 's#logo_link_url: "https://github.com/Haven-Organization",#logo_link_url: "https://element.io",#' \
        -e 's#auth_header_logo_url: "vector-icons/144.png",#auth_header_logo_url: "themes/element/img/logos/element-logo.svg",#' \
        "$ROOT_DIR/element-web/apps/web/src/SdkConfig.ts"
fi

if [ -n "${HAVEN_LOGIN_BACKGROUND:-}" ]; then
    if [ ! -f "$HAVEN_LOGIN_BACKGROUND" ]; then
        echo "HAVEN_LOGIN_BACKGROUND set to '$HAVEN_LOGIN_BACKGROUND', but that file doesn't exist" >&2
        exit 1
    fi
    echo "==> HAVEN_LOGIN_BACKGROUND set - baking in a custom login background"
    cp "$HAVEN_LOGIN_BACKGROUND" "$ELEMENT_WEB_DIR/apps/web/res/themes/element/img/backgrounds/lake.jpg"
fi

if [ -n "${HAVEN_NOTIFICATION_SOUND:-}" ]; then
    if [ ! -f "$HAVEN_NOTIFICATION_SOUND" ]; then
        echo "HAVEN_NOTIFICATION_SOUND set to '$HAVEN_NOTIFICATION_SOUND', but that file doesn't exist" >&2
        exit 1
    fi
    echo "==> HAVEN_NOTIFICATION_SOUND set - baking in a custom default notification sound"
    cp "$HAVEN_NOTIFICATION_SOUND" "$ELEMENT_WEB_DIR/apps/web/res/media/message.mp3"
    if [ -n "${HAVEN_NOTIFICATION_SOUND_OGG:-}" ]; then
        if [ ! -f "$HAVEN_NOTIFICATION_SOUND_OGG" ]; then
            echo "HAVEN_NOTIFICATION_SOUND_OGG set to '$HAVEN_NOTIFICATION_SOUND_OGG', but that file doesn't exist" >&2
            exit 1
        fi
        cp "$HAVEN_NOTIFICATION_SOUND_OGG" "$ELEMENT_WEB_DIR/apps/web/res/media/message.ogg"
    fi
fi

echo "==> Installing dependencies (this can take a while)"
cd "$ELEMENT_WEB_DIR"
corepack enable 2>/dev/null || true
corepack prepare pnpm@11.9.0 --activate
pnpm install

echo ""
echo "Done. See the README for how to build and run the web and desktop apps."
