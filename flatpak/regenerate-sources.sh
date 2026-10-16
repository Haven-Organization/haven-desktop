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

echo "==> Element Call component sources"
# apps/web depends on @element-hq/element-call-component, a git dependency that only exists once its
# `prepare` script has built it from the whole element-call repository, with element-call's own
# dependencies - and that build needs element-call's matrix-js-sdk (another git dependency) built too.
# Neither prepare step can run in the offline store, so build.sh does both itself, from the sources
# vendored here: the element-call tarball, element-call's packages and that matrix-js-sdk's packages.
EC_COMMIT="$(python3 -c 'import json,re,sys; print(re.search(r"#([0-9a-f]{40})", json.load(open(sys.argv[1]))["dependencies"]["@element-hq/element-call-component"]).group(1))' "$ROOT/element-web/apps/web/package.json")"
EC_URL="https://codeload.github.com/element-hq/element-call/tar.gz/$EC_COMMIT"
mkdir -p "$WORK/element-call"
curl -sSfL "$EC_URL" -o "$WORK/element-call.tgz"
tar -xzf "$WORK/element-call.tgz" -C "$WORK/element-call" --strip-components=1
JSSDK_COMMIT="$(grep -oE 'codeload.github.com/matrix-org/matrix-js-sdk/tar.gz/[0-9a-f]{40}' "$WORK/element-call/pnpm-lock.yaml" | head -1 | sed 's#.*/##')"
mkdir -p "$WORK/matrix-js-sdk"
curl -sSfL "https://codeload.github.com/matrix-org/matrix-js-sdk/tar.gz/$JSSDK_COMMIT" | tar -xz -C "$WORK/matrix-js-sdk" --strip-components=1
(
    cd "$TOOLS/node"
    python3 -m flatpak_node_generator --pnpm-store-version v11 \
        -o "$WORK/element-call-generated.json" pnpm "$WORK/element-call/pnpm-lock.yaml"
    python3 -m flatpak_node_generator --pnpm-store-version v11 \
        -o "$WORK/matrix-js-sdk-generated.json" pnpm "$WORK/matrix-js-sdk/pnpm-lock.yaml"
)
python3 - "$HERE/generated-sources.json" "$EC_URL" "$(sha256sum "$WORK/element-call.tgz" | cut -d' ' -f1)" \
    "$WORK/element-call-generated.json" element-call "$WORK/matrix-js-sdk-generated.json" matrix-js-sdk \
    "$HERE/element-call-sources.json" <<'PYEOF'
import json
import sys

main_path, ec_url, ec_sha256, ec_gen, ec_name, sdk_gen, sdk_name, dest = sys.argv[1:]

seen = {(e.get("dest"), e.get("dest-filename")) for e in json.load(open(main_path)) if e["type"] == "file"}
kept = [{"type": "archive", "archive-type": "tar-gzip", "url": ec_url, "sha256": ec_sha256, "dest": "element-call"}]
for path, name in ((ec_gen, ec_name), (sdk_gen, sdk_name)):
    for entry in json.load(open(path)):
        where = entry.get("dest", "")
        if "dest" not in entry or "ms-playwright" in where:
            # Store population and node headers setup (build.sh does these), and the browsers Element
            # Call's own tests run in (its install runs with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
            continue
        if entry.get("dest-filename") in ("populate_pnpm_store.py", "setup_sdk_node_headers.sh"):
            continue
        if entry.get("dest-filename") == "pnpm-manifest.json":
            entry = dict(entry, **{"dest-filename": f"pnpm-manifest-{name}.json"})
        elif entry["type"] == "file":
            key = (where, entry.get("dest-filename"))
            if key in seen:
                continue
            seen.add(key)
        kept.append(entry)
with open(dest, "w") as f:
    json.dump(kept, f, indent=4)
    f.write("\n")
print(f"element-call-sources.json: {len(kept)} sources")
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
