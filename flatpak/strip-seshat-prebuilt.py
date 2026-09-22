#!/usr/bin/env python3
"""
Removes the prebuilt @matrix-org/seshat-<platform>-<arch> native packages from a pnpm-lock.yaml.

@matrix-org/seshat lists one prebuilt binary package per platform as optional dependencies. The Flatpak
build compiles the module from source instead (see build.sh), so those packages must not be installed
- and, since Flathub disallows unpacking prebuilt binaries, are not vendored in generated-sources.json.
Removing them from the lockfile (rather than setting ignoredOptionalDependencies in pnpm-workspace.yaml)
matters: pnpm records that setting in the lockfile and re-resolves everything against the registry
when it changes, which can't work in the offline build sandbox.

Usage: strip-seshat-prebuilt.py path/to/pnpm-lock.yaml
"""
import re
import sys

path = sys.argv[1]
text = open(path).read()
prebuilt = r"@matrix-org/seshat-(?:darwin|linux|win32)-(?:arm64|x64)"

# The package's own entries in both the "packages:" and "snapshots:" sections.
text, entries = re.subn(r"^  '" + prebuilt + r"@[^']+':(?: \{\})?\n(?:    .*\n)*\n", "", text, flags=re.M)
# seshat's own optionalDependencies list, and the empty block that leaves behind.
text, deps = re.subn(r"^      '" + prebuilt + r"': [^\n]+\n", "", text, flags=re.M)
text = re.sub(r"^    optionalDependencies:\n(?=\n)", "", text, flags=re.M)
# A snapshot left with no body has to be an explicit empty mapping.
text = re.sub(r"^(  '@matrix-org/seshat@[^']+'):\n\n", r"\1: {}\n\n", text, flags=re.M)

if entries != 12 or deps != 6:
    sys.exit(f"unexpected lockfile shape: removed {entries} entries (want 12) and {deps} dependency lines (want 6)")
open(path, "w").write(text)
print(f"removed {entries} prebuilt seshat entries")
