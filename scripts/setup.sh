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
BRANDING_COMMIT="e92aa1bd70d07a9e9ffba574bf21ee637d57faaf"

# BRANDING_COMMIT also happens to be the same commit that first wired apps-framework.scss/
# social-overlay.scss into every theme's own top-level .pcss file (each file's *entire* diff in
# that commit is just those two @import lines - confirmed via `git show BRANDING_COMMIT -- <path>`
# for each one below, nothing else). That's an unrelated concern that only rode along because it
# landed in the same commit as the actual rebrand - reverting "branding" should never mean Social's
# own CSS silently stops loading (e.g. a profile room's own Settings dialog reaches BannerSetting.tsx
# regardless of whether the Social app/nav itself is reachable, and it renders completely unstyled -
# unbounded image, no crop - without this CSS). Excluded from the revert loop below rather than
# folded into BRANDING_COMMIT^'s content, so an unbranded build still gets Haven's own component
# styling wherever it's still reachable; only the *visual identity* (logos/icons/backgrounds/copy)
# actually reverts.
THEME_IMPORT_FILES=(
    "element-web/apps/web/res/themes/dark/css/dark.pcss"
    "element-web/apps/web/res/themes/dark-custom/css/dark-custom.pcss"
    "element-web/apps/web/res/themes/legacy-dark/css/legacy-dark.pcss"
    "element-web/apps/web/res/themes/legacy-light/css/legacy-light.pcss"
    "element-web/apps/web/res/themes/light/css/light.pcss"
    "element-web/apps/web/res/themes/light-custom/css/light-custom.pcss"
    "element-web/apps/web/res/themes/light-high-contrast/css/light-high-contrast.pcss"
)

if [ -n "${HAVEN_NO_BRANDING:-}" ]; then
    echo "==> HAVEN_NO_BRANDING set - reverting to stock Element branding"
    # Files the branding commit modified existed before it too, so `git checkout <parent> --
    # <path>` restores their pre-branding content. Files it added (e.g. the Haven-specific desktop
    # build variant) don't exist at <parent> at all, so the same checkout would fail on them -
    # those instead need removing outright. [ -e "$path" ] guards that removal so re-running this
    # against an already-reverted tree (e.g. building twice in a row without switching branding
    # back in between) doesn't fail trying to `git rm` a path that's already gone.
    while IFS=$'\t' read -r status path; do
        skip=0
        for theme_file in "${THEME_IMPORT_FILES[@]}"; do
            [ "$path" = "$theme_file" ] && skip=1 && break
        done
        [ "$skip" -eq 1 ] && continue
        case "$status" in
            A) [ -e "$ROOT_DIR/$path" ] && git -C "$ROOT_DIR" rm -q -f -- "$path" ;;
            *) git -C "$ROOT_DIR" checkout "${BRANDING_COMMIT}^" -- "$path" ;;
        esac
    done < <(git -C "$ROOT_DIR" diff --name-status "${BRANDING_COMMIT}^" "$BRANDING_COMMIT")
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
corepack prepare pnpm@11.2.2 --activate
pnpm install

echo ""
echo "Done. See the README for how to build and run the web and desktop apps."
