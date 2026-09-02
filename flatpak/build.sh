#!/bin/bash
set -e

mkdir -p pnpm-cli && tar -xzf pnpm-11.22.0.tgz -C pnpm-cli

sed -i 's/minimumReleaseAgeStrict: true/minimumReleaseAgeStrict: false/' element-web/pnpm-workspace.yaml
sed -i '/^trustLockfile:/d' element-web/pnpm-workspace.yaml
echo 'trustLockfile: true' >> element-web/pnpm-workspace.yaml

python3 flatpak-node/populate_pnpm_store.py flatpak-node/pnpm-manifest.json flatpak-node/pnpm-tarballs flatpak-node/pnpm-store

sed -i '/^storeDir:/d' element-web/pnpm-workspace.yaml
echo 'storeDir: '$PWD'/flatpak-node/pnpm-store' >> element-web/pnpm-workspace.yaml

cd element-web && pnpm install --offline --frozen-lockfile=false --config.strictStorePkgContentCheck=false && cd ..

cd element-web/apps/web && HAVEN_INCLUDE_OLD_ROOM_LIST=1 pnpm build && cd ../../..

cp element-web/apps/web/config.sample.json element-web/apps/web/webapp/config.json

cd element-web/apps/desktop && pnpm exec asar pack ../web/webapp webapp.asar && cd ../../..

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
