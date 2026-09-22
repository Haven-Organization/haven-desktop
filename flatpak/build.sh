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

# @matrix-org/seshat lists prebuilt native binaries for every platform as optional dependencies. They
# are neither vendored nor wanted here (the module is built from source below), so take them out of
# the lockfile before installing - see strip-seshat-prebuilt.py for why this isn't a pnpm setting.
python3 flatpak/strip-seshat-prebuilt.py element-web/pnpm-lock.yaml

# `pnpm install` runs apps/desktop's `electron-builder install-app-deps`, which rebuilds its native
# dependencies (pkcs11js, for upstream's X.509 verification) for Electron with node-gyp. @electron/rebuild
# keeps Electron's node headers in ~/.electron-gyp and downloads them from electronjs.org when they are
# missing, which the sandbox can't do - so point that directory at the headers the manifest vendors
# (generated-sources.json puts them in the node-gyp cache, which has the same layout).
ln -sfn "$ROOT/flatpak-node/cache/node-gyp" "$HOME/.electron-gyp"

cd element-web && CI=true pnpm install --offline --frozen-lockfile=false --config.strictStorePkgContentCheck=false && cd ..

cd element-web/apps/web && HAVEN_INCLUDE_OLD_ROOM_LIST=1 pnpm build && cd ../../..

cp element-web/apps/web/config.sample.json element-web/apps/web/webapp/config.json

cd element-web/apps/desktop && pnpm exec asar pack ../web/webapp webapp.asar && cd ../../..

# Build matrix-seshat (local encrypted-room message search) from source.
#
# Upstream used to build it with its own "hak" tool; it now depends on the published
# @matrix-org/seshat package instead, which loads a native module from a prebuilt per-platform
# package (@matrix-org/seshat-linux-x64 and friends) and, only if none is installed, falls back to
# requiring its own ./index.node. Flathub requires building from source rather than unpacking
# prebuilt binaries, so this never installs those prebuilt packages (see
# strip-seshat-prebuilt.py above and the filtered generated-sources.json) and compiles the
# Rust crate the package ships (Cargo.toml + src/) into that ./index.node itself - the same output
# the package's own "build-bundled" script produces (cargo build --release --features
# bundled-sqlcipher, then copy the cdylib to index.node), minus the cargo-cp-artifact helper.
#
# Everything cargo needs comes from the manifest (matrix-seshat-cargo-sources.json, the crates
# vendored under $ROOT/cargo) and the Rust SDK extension, so this runs with no network. One quirk:
# the Cargo.lock inside the published @matrix-org/seshat 6.0.1 tarball is stale (it still pins the
# 5.0.0 release's dependency set - seshat 4.1.0 - while Cargo.toml asks for seshat 5.0.0), which cargo
# can't reconcile offline. matrix-seshat-Cargo.lock is the lockfile `cargo generate-lockfile` produces
# for the shipped Cargo.toml, and matrix-seshat-cargo-sources.json was generated from it; regenerate
# both together whenever the @matrix-org/seshat version changes.
export PATH="/usr/lib/sdk/rust-stable/bin:$PATH"
SESHAT_PKG="$(realpath element-web/apps/desktop/node_modules/@matrix-org/seshat)"
rm -rf "$ROOT/seshat-build"
cp -rL "$SESHAT_PKG" "$ROOT/seshat-build"
chmod -R u+w "$ROOT/seshat-build"
cp flatpak/matrix-seshat-Cargo.lock "$ROOT/seshat-build/Cargo.lock"
(
    cd "$ROOT/seshat-build"
    HOME="$ROOT" CARGO_HOME="$ROOT/cargo" CARGO_NET_OFFLINE=true \
        cargo build --release --locked --offline --features bundled-sqlcipher
    cp target/release/libmatrix_seshat.so "$SESHAT_PKG/index.node"
)
# Fail here, not at first launch, if the module doesn't actually load.
(cd element-web/apps/desktop && node -e 'const m = require("@matrix-org/seshat"); if (!m.Seshat) process.exit(1)')

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
install -Dm644 assets/logo.svg /app/share/icons/hicolor/scalable/apps/software.haven.HavenDesktop.svg
install -Dm755 flatpak/haven-desktop.sh /app/bin/haven-desktop
install -Dm644 flatpak/software.haven.HavenDesktop.desktop /app/share/applications/software.haven.HavenDesktop.desktop
install -Dm644 flatpak/software.haven.HavenDesktop.metainfo.xml /app/share/metainfo/software.haven.HavenDesktop.metainfo.xml
