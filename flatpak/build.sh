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
sed -i 's/shell: true,/shell: false,/g' element-web/apps/desktop/hak/matrix-seshat/build.ts

# shell: false alone isn't enough on its own, though - the real npm "yarn" package's installed
# bin/yarn (what PATH resolves "yarn" to) is *itself* a "#!/bin/sh" script (bin/yarn.js, its real JS
# entry point, is "#!/usr/bin/env node" instead). Without a shell, the kernel still has to interpret
# that shebang line to exec bin/yarn at all - same missing-/bin/sh problem one level down, confirmed
# live against a second real aarch64 CI failure ("Error: spawn yarn ENOENT" once shell: false alone
# was in place). Routing both calls through `node yarn.js ...` directly sidesteps bin/yarn's shell
# shebang entirely.
#
# A literal "node" string still isn't enough, though (confirmed live against a *third* real aarch64
# CI failure, "Error: spawn node ENOENT" - the yarn.js path in spawnargs was correct, proving this
# sed itself worked). child_process.spawn's own PATH-based executable lookup for "node" failed even
# though this exact script is already running under node right now, invoked successfully moments
# earlier - some difference between the shell/pnpm-script PATH that launched *this* process and
# whatever PATH child_process.spawn resolved "node" against here. Using process.execPath (node's own
# absolute path to itself, always valid, no PATH lookup involved at all) sidesteps the question
# entirely instead of chasing down that PATH discrepancy.
sed -i 's#hakEnv\.spawn("yarn", \[#hakEnv.spawn(process.execPath, ["'"$ROOT"'/yarn-cli/package/bin/yarn.js", #g' \
    element-web/apps/desktop/hak/matrix-seshat/build.ts

# The manifest's matrix-seshat sources (the pre-extracted npm tarball and its pinned yarn.lock -
# see the manifest's own archive/file sources for element-web/apps/desktop/.hak/matrix-seshat/
# x86_64-unknown-linux-gnu/build) have to hardcode one target triple in their dest path, because a
# flatpak manifest source can't itself branch on which arch flatpak-builder happens to be building
# for. hak's own moduleBuildDir (scripts/hak/index.ts) is built from hakEnv.getTargetId() instead,
# which resolves per-arch at build time - x86_64-unknown-linux-gnu there too on an x86_64 build (so
# this was never wrong locally or in any x86_64 CI run), but aarch64-unknown-linux-gnu on aarch64.
# Confirmed via this file's own now-removed diagnostic block: the real root cause of the
# "spawn ... ENOENT" failures chased across the last three releases was never the spawned
# executable at all (node --version at that literal path worked fine) - it was hakEnv.spawn's own
# cwd option (moduleInfo.moduleBuildDir) pointing at a directory that plain doesn't exist on
# aarch64, since the manifest only ever populated the x86_64 one. Node's child_process.spawn
# mis-reports a missing cwd as ENOENT against the executable path instead of the cwd itself - a
# well known footgun - which is exactly why three straight, individually-correct fixes to *how*
# the executable was being resolved (shell:true, the yarn wrapper script, a literal "node" string)
# never actually did anything on aarch64: none of them touched the real problem. Relocating the
# manifest's pre-populated directory to whatever this build's actual target triple resolves to
# fixes every arch flatpak-builder might build for, not just aarch64.
HAK_TARGET_TRIPLE="$(uname -m)-unknown-linux-gnu"
if [ "$HAK_TARGET_TRIPLE" != "x86_64-unknown-linux-gnu" ]; then
    mv element-web/apps/desktop/.hak/matrix-seshat/x86_64-unknown-linux-gnu \
        element-web/apps/desktop/.hak/matrix-seshat/"$HAK_TARGET_TRIPLE"
fi

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
