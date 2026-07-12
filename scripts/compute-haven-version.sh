#!/usr/bin/env bash
# Computes Haven's own version string:
#   haven-<haven-version>+element-<element-version>[_<code-hash>]
#
# Haven's own version leads and is explicitly labeled ("haven-"), since that's what actually
# identifies this build - HAVEN_VERSION at the repo root, bumped each time Haven itself ships a
# change, independently of Element's own release cadence. Element's pinned version follows as a
# "+element-..." suffix so it's still easy to see which upstream release this build sits on (useful
# for support/debugging, since Haven is a thin patch on a pinned Element tag). Both segments are
# explicitly labeled so neither can be misread as the other - an earlier version of this format left
# the leading segment unlabeled, which looked inconsistent next to the explicitly-labeled suffixes.
#
# The trailing "_<code-hash>" (attached directly to the element version, not a separate "+"-prefixed
# segment - it qualifies *which exact patch state* of that pinned element version this is, not a
# third independent thing) only appears when patches/haven-code.patch exists (i.e. this is the
# publishable repo's pinned-tag + patch layout, not the dev repo's own element-web checkout with
# Haven's changes committed directly into its git history). In that layout, element_version's own
# git describe alone can't tell two different builds apart: it just reports the pinned tag, with no
# differentiator if the patch (or the branding/app code it doesn't cover) changes between builds at
# the same tag - a bug report's version string would be identical either way. The dev repo doesn't
# have this problem (Haven's changes are real commits, already uniquely identified by
# element_version's own commit count + SHA), which is also why this script no-ops there instead of
# always appending a hash - nothing to disambiguate.
#
# Used by both build outputs: apps/web/scripts/package.sh calls this directly for the web tarball
# name; the desktop build picks up the same string by exporting it as VERSION before `pnpm build`
# (see README's Build Quickstart) - electron-builder reads VERSION directly, no separate wiring
# needed.
#
# Usage: ./scripts/compute-haven-version.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

haven_version=$(cat "$ROOT_DIR/HAVEN_VERSION" 2>/dev/null || echo unknown)
element_version=$(git -C "$ROOT_DIR/element-web" describe --tags || echo unknown)

version="haven-v${haven_version}+element-${element_version}"

PATCH_FILE="$ROOT_DIR/patches/haven-code.patch"
if [ -f "$PATCH_FILE" ]; then
    # A "hash of hashes" over path+content (not just concatenated content) so a rename/move, not
    # just an edit, also changes the result - sorted first so the result doesn't depend on
    # filesystem enumeration order.
    haven_code_hash=$(
        {
            sha256sum "$PATCH_FILE"
            find "$ROOT_DIR/patches/branding" "$ROOT_DIR/src/apps" "$ROOT_DIR/docs" "$ROOT_DIR/assets" \
                -type f -exec sha256sum {} \; 2>/dev/null
        } | sort | sha256sum | cut -c1-10
    )
    version="${version}_${haven_code_hash}"
fi

echo "$version"
