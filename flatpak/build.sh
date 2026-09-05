#!/bin/bash
set -e

ROOT="$PWD"

mkdir -p pnpm-cli && tar -xzf pnpm-11.23.0.tgz -C pnpm-cli

sed -i 's/minimumReleaseAgeStrict: true/minimumReleaseAgeStrict: false/' element-web/pnpm-workspace.yaml
sed -i '/^trustLockfile:/d' element-web/pnpm-workspace.yaml
echo 'trustLockfile: true' >> element-web/pnpm-workspace.yaml

python3 flatpak-node/populate_pnpm_store.py flatpak-node/pnpm-manifest.json flatpak-node/pnpm-tarballs flatpak-node/pnpm-store

sed -i '/^storeDir:/d' element-web/pnpm-workspace.yaml
echo 'storeDir: '$PWD'/flatpak-node/pnpm-store' >> element-web/pnpm-workspace.yaml

cd element-web && CI=true pnpm install --offline --frozen-lockfile=false --config.strictStorePkgContentCheck=false && cd ..

cd element-web/apps/web && HAVEN_INCLUDE_OLD_ROOM_LIST=1 pnpm build && cd ../../..

cp element-web/apps/web/config.sample.json element-web/apps/web/webapp/config.json

cd element-web/apps/desktop && pnpm exec asar pack ../web/webapp webapp.asar && cd ../../..

# Build matrix-seshat (local encrypted-room message search) from source using Element's own "hak"
# native-module build tool. Never wired up for this from-source build before now - matrix-seshat
# only ever made it into a shippable build via a manually pre-built
# ".hak/hakModules/matrix-seshat" directory nobody's from-scratch checkout (including this one)
# could reproduce, so every published build here has been silently shipping a "Cannot find
# package 'matrix-seshat'" runtime error instead of real search - confirmed live by extracting
# app.asar from a real published build. hak's own lifecycle (fetch/link/build/copy - see
# apps/desktop/scripts/hak/README.md) runs entirely without Docker (that's only an optional
# reproducibility wrapper for scripts/in-docker.sh, not something hak itself needs - checked by
# reading fetch.ts/build.ts/link.ts/copy.ts directly), so it runs right here the same way this
# script already runs pnpm/webpack/electron-builder inside flatpak-builder's own sandboxed SDK
# environment. Verified locally end-to-end (deleted .hak entirely, real network, confirmed the
# resulting index.node loads and exposes the expected native functions) before writing this, then
# verified again fully offline (isolated CARGO_HOME + `cargo vendor`, CARGO_NET_OFFLINE=true) to
# confirm the vendored-sources approach below actually works, not just the theory.
#
# hak's own "fetch" stage (a pacote npm-registry fetch, then `yarn install`) needs live network
# access flatpak-builder's sandboxed build never has - worked around by having the *manifest*
# extract the same matrix-seshat npm tarball directly into both directories fetch.ts would
# otherwise populate (moduleBuildDir and moduleOutDir - fetch.ts skips its own fetch entirely once
# moduleBuildDir already exists), so hak's later check/link/build/copy stages behave exactly as if
# a normal fetch had already happened. yarn (hak hardcodes it, not pnpm) and Rust both come from
# manifest-provided sources/SDK extensions rather than being fetched here.
#
# One real gotcha found only by actually testing this offline (not just reading the source):
# published matrix-seshat npm tarballs don't ship their own yarn.lock - fetch.ts's own
# `yarn install --ignore-scripts` step is what *generates* one from package.json's loose semver
# ranges, resolved against whatever's live in the registry at fetch time. Skipping fetch.ts (as
# above) skips that generation too, so without also placing a real yarn.lock into moduleBuildDir,
# the later `yarn install` inside hak's build stage has nothing to resolve from and fails outright
# even with the offline mirror fully populated (confirmed live: "No lockfile found", then a real
# network attempt straight to the registry). The manifest's matrix-seshat npm-tarball source needs
# a pinned yarn.lock layered in on top for the same dest - see flatpak-seshat-vendoring/README.md
# for exactly which file and where.
mkdir -p yarn-cli && tar -xzf yarn-1.22.22.tgz -C yarn-cli
export PATH="$ROOT/yarn-cli/package/bin:/usr/lib/sdk/rust-stable/bin:$PATH"
HOME="$ROOT" yarn config --offline set yarn-offline-mirror "$ROOT/flatpak-node/yarn-mirror"

# hak/matrix-seshat/build.ts's own "yarn install" call has no --offline flag - having the mirror
# configured isn't enough on its own, classic Yarn 1.x still does a DNS lookup against
# registry.yarnpkg.com first ("Fetching packages...") and fails outright in a real network-less
# sandbox (confirmed live: a real flatpak-builder run failed here with
# "getaddrinfo EAI_AGAIN registry.yarnpkg.com" even with every package already in the mirror) -
# an earlier local-only offline test missed this because it used an unreachable IP instead of an
# unresolvable hostname, which fails a different way and didn't exercise this exact code path.
sed -i 's#hakEnv\.spawn("yarn", \["install"\]#hakEnv.spawn("yarn", ["install", "--offline"]#' \
    element-web/apps/desktop/hak/matrix-seshat/build.ts

# Both of this file's own hakEnv.spawn() calls (install, run build) pass shell: true unconditionally
# - hakEnv.spawn's own default is shell: this.isWin() (false on Linux), so this file opts back into
# a shell wrapper it doesn't actually need (neither command uses pipes/globs/redirects). Confirmed a
# real Flathub aarch64 CI build failing here with "Error: spawn /bin/sh ENOENT" - that architecture's
# build sandbox has no /bin/sh at all (x86_64 does, which is why this was never caught testing there).
# Forcing shell: false sidesteps the missing-shell environment gap entirely rather than chasing down
# why that one architecture's sandbox lacks /bin/sh.
sed -i 's/shell: true,/shell: false,/g' element-web/apps/desktop/hak/matrix-seshat/build.ts

cd element-web/apps/desktop
for hak_stage in check link build copy; do
    HOME="$ROOT" CARGO_HOME="$ROOT/cargo" CARGO_NET_OFFLINE=true SQLCIPHER_BUNDLED=1 \
        pnpm run hak "$hak_stage" matrix-seshat
done
cd ../../..

sed -i 's#export default config;#config.publish = null; config.electronDist = "/run/build/haven-desktop/flatpak-node/cache/electron"; config.linux = config.linux || {}; config.linux.target = ["dir"]; export default config;#' element-web/apps/desktop/electron-builder.ts

# VERSION (electron-builder's packaged `version` field) has to stay a strict X.Y.Z - HAVEN_VERSION
# at the repo root already is one. HAVEN_FULL_VERSION is the separate, full descriptive string
# (haven-v<haven-version>+element-<element-version>...) Help & About actually shows - see ipc.ts's
# getAppVersion and compute-haven-version.sh's own comments. Both used to be hardcoded to whatever
# version was current when this line was last edited (VERSION=0.7.3, HAVEN_FULL_VERSION unset
# entirely) - every release since kept bumping HAVEN_VERSION/tagging without anyone remembering to
# also edit this file, so Flathub kept shipping a build that identified itself as 0.7.3 no matter
# how many releases had actually gone out. Computing both from the same source setup.sh's own
# release process already maintains removes the manual step entirely.
HAVEN_VERSION=$(cat HAVEN_VERSION)
HAVEN_FULL_VERSION=$(./scripts/compute-haven-version.sh)
cd element-web/apps/desktop && VERSION=$HAVEN_VERSION HAVEN_FULL_VERSION=$HAVEN_FULL_VERSION pnpm build -- --linux dir --publish=never && cd ../../..

mkdir -p /app/Haven
cp -r element-web/apps/desktop/dist/linux*-unpacked/* /app/Haven/

install -Dm644 assets/logo_512.png /app/share/icons/hicolor/512x512/apps/software.haven.HavenDesktop.png
install -Dm644 flatpak/software.haven.HavenDesktop.svg /app/share/icons/hicolor/scalable/apps/software.haven.HavenDesktop.svg
install -Dm755 flatpak/haven-desktop.sh /app/bin/haven-desktop
install -Dm644 flatpak/software.haven.HavenDesktop.desktop /app/share/applications/software.haven.HavenDesktop.desktop
install -Dm644 flatpak/software.haven.HavenDesktop.metainfo.xml /app/share/metainfo/software.haven.HavenDesktop.metainfo.xml
