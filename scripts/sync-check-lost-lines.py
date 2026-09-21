#!/usr/bin/env python3
"""
After an upstream sync (scripts/sync-upstream.sh) has been resolved and staged, lists every line Haven
added to a file (relative to the last-merged upstream state) that is missing from the merged result.

Git only flags the lines two sides both edited; a Haven-only line next to a resolved conflict can be
silently dropped with no marker at all (see "third sharper edge" in the feedback-auto-sync-upstream-develop
memory). Each hit is either an intentional resolution (upstream replaced or removed that code) or a real
loss to restore - look at every one.

Usage: scripts/sync-check-lost-lines.py [path-substring-to-skip ...]
"""
import collections
import re
import subprocess
import sys

git_dir = subprocess.run(["git", "rev-parse", "--git-dir"], capture_output=True, text=True, check=True).stdout.strip()
base_tree = open(f"{git_dir}/sync-upstream/base-tree").read().strip()
skip = sys.argv[1:]
trivial = re.compile(r"^[\s{}();,\[\]]*$")


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, errors="replace").stdout


files = []
for line in run("git", "diff", "--name-status", "-M", base_tree, "HEAD", "--", "element-web").splitlines():
    parts = line.split("\t")
    if parts[0][0] in "MAR":
        files.append(parts[-1])

hits = 0
for f in files:
    if any(k in f for k in skip) or f.endswith((".png", ".woff2", ".jpg", ".lock", "pnpm-lock.yaml")):
        continue
    merged = subprocess.run(["git", "show", f":0:{f}"], capture_output=True, text=True, errors="replace")
    if merged.returncode != 0:
        continue
    if "<<<<<<<" in merged.stdout:
        print(f"### {f}: CONFLICT MARKERS")
        hits += 1
        continue
    have = collections.Counter(l.strip() for l in merged.stdout.splitlines())
    added = [
        l[1:].strip()
        for l in run("git", "diff", "-U0", base_tree, "HEAD", "--", f).splitlines()
        if l.startswith("+") and not l.startswith("+++")
    ]
    need = collections.Counter(l for l in added if not trivial.match(l))
    missing = [l for l, c in need.items() if have[l] < c]
    if missing:
        hits += 1
        print(f"### {f.replace('element-web/', '')}  missing={len(missing)}")
        for l in missing[:12]:
            print("    ", l[:150])
        if len(missing) > 12:
            print("     ...")

print(f"checked {len(files)} Haven-modified files, {hits} with lines missing from the merge")
