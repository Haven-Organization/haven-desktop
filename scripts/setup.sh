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
        for excluded_file in "${BRANDING_REVERT_EXCLUDE[@]}"; do
            [ "$path" = "$excluded_file" ] && skip=1 && break
        done
        [ "$skip" -eq 1 ] && continue
        case "$status" in
            A) [ -e "$ROOT_DIR/$path" ] && git -C "$ROOT_DIR" rm -q -f -- "$path" ;;
            *) git -C "$ROOT_DIR" checkout "${BRANDING_COMMIT}^" -- "$path" ;;
        esac
    done < <(git -C "$ROOT_DIR" diff --name-status "${BRANDING_COMMIT}^" "$BRANDING_COMMIT")

    # Unlike AuthFooter.tsx/the theme .pcss files above, these two files' branding-relevant content
    # can't just be excluded wholesale - electron-builder.ts's own DEFAULT_VARIANT genuinely needs to
    # revert back to "element.io/release/build.json" (the Haven-specific "haven/release/build.json"
    # it'd otherwise still point at was just removed above, per its own "A" status), and package.sh's
    # version-naming scheme reverting to plain `git describe` is correct too - showing "haven-v0.2+..."
    # in a build that's trying to hide Haven's own identity would be self-defeating. But both files
    # also had a real, non-branding fix land in the same commit, patched back in here rather than
    # lost: electron-builder.ts's own linux.target dropped AppImage entirely on revert (silently
    # losing that packaging format for an unbranded desktop build, not just a cosmetic difference),
    # and package.sh's own staging-directory cleanup (rm -rf before cp -r) prevents a previous
    # interrupted/killed build's leftover cruft from polluting a new one - unrelated to branding
    # either way. Both sed patterns below match text that's only ever present in each file's stock
    # (reverted-to) form, so they're no-ops if this block doesn't run (HAVEN_NO_BRANDING unset).
    sed -i 's/target: \["tar.gz", "deb"\],/target: ["tar.gz", "deb", "AppImage"],/' \
        "$ROOT_DIR/element-web/apps/desktop/electron-builder.ts"
    sed -i 's/cp -r webapp element-\$version/rm -rf element-$version\ncp -r webapp element-$version/' \
        "$ROOT_DIR/element-web/apps/web/scripts/package.sh"
    # Same as Haven's own committed package.sh fix (see its own comment): webpack's output.path
    # (webapp/) has no `clean` option, so nothing ever wipes a previous build's bundle directory
    # before the next one runs - every build in a checkout's history piles up there and gets copied
    # into the tarball wholesale. Confirmed 2026-07-22: a 48-build-deep webapp/ produced a ~1.9G
    # tarball that should've been ~160M. This sed just re-adds the same fix on top of the stock
    # (reverted-to) form's own `VERSION=$version pnpm build` line.
    sed -i 's/VERSION=\$version pnpm build/rm -rf webapp\nVERSION=$version pnpm build/' \
        "$ROOT_DIR/element-web/apps/web/scripts/package.sh"

    # webpack.config.ts's own branding-commit diff is the same kind of mix as the two files above -
    # can't be excluded wholesale (the OG image URL default and VERSION string scheme genuinely are
    # branding and should revert), but it also bundled in an unrelated dependency swap that reverting
    # otherwise silently undoes: the stock "oidc-client-ts" resolve.alias comes back (a package this
    # fork doesn't actually have installed - HAVEN_INCLUDE_OLD_ROOM_LIST or not, this alone breaks
    # every unbranded build outright), and Haven's own "legacy-room-list" alias (see that env var's
    # own comment above) disappears - an unbranded build with HAVEN_INCLUDE_OLD_ROOM_LIST=1 would
    # fail to resolve that specifier at all. Confirmed live 2026-07-22 building "glowers element"
    # with the old room list flag together for the first time - this combination had never actually
    # been exercised before. Patched back in here the same way as the two sed calls above; a no-op
    # if this block doesn't run.
    python3 - "$ROOT_DIR/element-web/apps/web/webpack.config.ts" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

old = (
    '                "matrix-widget-api": getPackageRoot("matrix-widget-api"),\n'
    '                "oidc-client-ts": getPackageRoot("oidc-client-ts"),\n'
    "\n"
    "                // Make shared-components imports resolve to EW deps\n"
    '                "@vector-im/compound-web": getPackageRoot("@vector-im/compound-web", ""),\n'
    "            },"
)
new = (
    '                "matrix-widget-api": getPackageRoot("matrix-widget-api"),\n'
    "\n"
    "                // Make shared-components imports resolve to EW deps\n"
    '                "@vector-im/compound-web": getPackageRoot("@vector-im/compound-web", ""),\n'
    "\n"
    "                // Haven: the legacy room list is only bundled in at all when explicitly asked for\n"
    "                // at build time (off by default) - callers only ever import the \"legacy-room-list\"\n"
    "                // specifier, never a relative path into src/legacy-room-list directly, so this\n"
    "                // alias is the single point deciding whether the real ~40-file subsystem or a tiny\n"
    "                // always-present stub ends up in the output. See src/legacy-room-list/index.ts and\n"
    "                // src/legacy-room-list-stub/index.ts's own doc.\n"
    '                "legacy-room-list": path.resolve(\n'
    "                    __dirname,\n"
    "                    process.env.HAVEN_INCLUDE_OLD_ROOM_LIST\n"
    '                        ? "src/legacy-room-list"\n'
    '                        : "src/legacy-room-list-stub",\n'
    "                ),\n"
    "            },"
)

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
PYEOF
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
