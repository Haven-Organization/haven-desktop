#!/bin/bash
# Regenerates the vendored sources this Flatpak build needs from the repo's current lockfiles:
#   generated-sources.json          every pnpm package (plus Electron, its node headers, esbuild and
#                                   Playwright caches), minus the prebuilt @matrix-org/seshat-* binaries
#   matrix-seshat-cargo-sources.json the Rust crates matrix-seshat is compiled from
#   matrix-seshat-Cargo.lock        the pinned lockfile for that crate
#
# Run it after anything that changes element-web/pnpm-lock.yaml or the @matrix-org/seshat version (every
# upstream sync does). Needs network, python3 with aiohttp/pyyaml/toml/tomlkit, cargo, and a checkout of
# https://github.com/flatpak/flatpak-builder-tools.
#
# Usage: flatpak/regenerate-sources.sh /path/to/flatpak-builder-tools
set -euo pipefail

TOOLS="${1:?usage: $0 /path/to/flatpak-builder-tools}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> pnpm sources"
# pnpm-lock.yaml starts with a stray second YAML document (pnpm's own packageManagerDependencies
# bookkeeping); the generator's parser only wants the real one, which starts at the second '---'.
awk '/^---$/ { n++ } n >= 2' "$ROOT/element-web/pnpm-lock.yaml" > "$WORK/pnpm-lock.yaml"
(
    cd "$TOOLS/node"
    # --electron-node-headers: apps/desktop's native dependencies (pkcs11js) are rebuilt for Electron by
    # `electron-builder install-app-deps` during pnpm install, which downloads Electron's node headers.
    python3 -m flatpak_node_generator --pnpm-store-version v11 --electron-node-headers \
        -o "$WORK/generated-sources.json" pnpm "$WORK/pnpm-lock.yaml"
)
python3 - "$WORK/generated-sources.json" "$HERE/generated-sources.json" <<'PYEOF'
import json
import sys

src, dest = sys.argv[1], sys.argv[2]

def prebuilt(name):
    # @matrix-org__seshat-<platform>-<arch>-<version>.tgz, but not @matrix-org__seshat-<version>.tgz itself
    return name.startswith("@matrix-org__seshat-") and not name.startswith("@matrix-org__seshat-6")

sources = json.load(open(src))
kept = []
for entry in sources:
    name = entry.get("dest-filename", "")
    if entry["type"] == "file" and entry.get("dest") == "flatpak-node/pnpm-tarballs" and prebuilt(name):
        continue
    if name == "pnpm-manifest.json":
        manifest = json.loads(entry["contents"])
        manifest["packages"] = {k: v for k, v in manifest["packages"].items() if not prebuilt(k)}
        entry = dict(entry, contents=json.dumps(manifest, separators=(",", ":"), sort_keys=True))
    kept.append(entry)
with open(dest, "w") as f:
    json.dump(kept, f, indent=4)
    f.write("\n")
print(f"generated-sources.json: {len(sources)} sources, {len(sources) - len(kept)} prebuilt seshat entries dropped")
PYEOF

echo "==> matrix-seshat cargo sources"
SESHAT="$(cd "$ROOT/element-web/apps/desktop" && realpath node_modules/@matrix-org/seshat)"
cp -rL "$SESHAT" "$WORK/seshat"
chmod -R u+w "$WORK/seshat"
# The Cargo.lock published inside the npm package is stale (it doesn't match its own Cargo.toml), so
# resolve a fresh one - see build.sh.
rm -f "$WORK/seshat/Cargo.lock"
(cd "$WORK/seshat" && cargo generate-lockfile)
cp "$WORK/seshat/Cargo.lock" "$HERE/matrix-seshat-Cargo.lock"
python3 "$TOOLS/cargo/flatpak-cargo-generator.py" "$HERE/matrix-seshat-Cargo.lock" -o "$WORK/cargo-sources.json"
python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1])), open(sys.argv[2], "w"), indent=4); open(sys.argv[2], "a").write("\n")' \
    "$WORK/cargo-sources.json" "$HERE/matrix-seshat-cargo-sources.json"
echo "done - review 'git diff --stat flatpak/' before committing"
