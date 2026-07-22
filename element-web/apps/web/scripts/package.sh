#!/usr/bin/env bash

set -e

if [ -n "$DIST_VERSION" ]; then
    version=$DIST_VERSION
else
    # haven apps-framework patch: haven-v<haven-version>+element-<element-version>[_<code-hash>]
    # (see compute-haven-version.sh) instead of stock's own `git describe --dirty --tags` - --dirty is
    # dropped deliberately: applying Haven's own patch always leaves this checkout "dirty" relative
    # to the pinned tag, so --dirty would show on every real Haven build regardless of whether
    # anything is actually uncommitted beyond the patch itself.
    version=`../../../scripts/compute-haven-version.sh || echo unknown`
fi

# webpack's own output.path (webapp/) has no `clean` option set, so nothing ever removes a
# previous build's own content-hashed bundle directory before writing a new one - every build in
# this checkout's history piles up in webapp/bundles/ forever, and the whole directory gets copied
# into the tarball below wholesale. Confirmed 2026-07-22: 48 accumulated bundle dirs, ~1.9G, on a
# tarball that should be ~160M. Wiping first keeps each build (and its tarball) containing only
# its own output.
rm -rf webapp

VERSION=$version pnpm build

# include the sample config in the tarball. Arguably this should be done by
# `pnpm build`, but it's just too painful.
cp config.sample.json webapp/

mkdir -p dist

# Wipe any stale staging directory left behind by a previous interrupted/killed run —
# otherwise this cp merges into leftover cruft instead of starting from a clean copy of webapp/.
rm -rf $version
cp -r webapp $version

# Just in case you have a local config, remove it before packaging
rm $version/config.json || true

# GNU/BSD compatibility workaround
tar_perms=(--owner=0 --group=0) && [ "$(uname)" == "Darwin" ] && tar_perms=(--uid=0 --gid=0)
tar "${tar_perms[@]}" -chvzf dist/$version.tar.gz $version
rm -r $version

echo
echo "Packaged dist/$version.tar.gz"
