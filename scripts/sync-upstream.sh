#!/usr/bin/env bash
# Merges upstream element-hq/element-web's `develop` branch into ours.
#
# Usage: ./scripts/sync-upstream.sh
#
# Why this exists instead of a plain `git merge origin/develop`: commit 27f4a5a303 ("Move
# element-web into element-web/ subdirectory", 2026-07-12) wrapped the whole upstream tree under
# element-web/ via an ordinary `git mv` + commit, not `git subtree`. Because of that, a plain merge
# can't tell "upstream renamed/added X at its native path" apart from "Haven's history shows
# everything moved under element-web/*" - every upstream commit that renames or reorganizes a
# directory turns into a git CONFLICT (file location)/(directory rename split) for every file it
# touches, even when the underlying change is trivial. A 162-commit sync attempted on 2026-08-26
# produced 1037 raw conflicts this way, most of them this exact class, and was aborted rather than
# resolved blind.
#
# The fix, in two steps:
#  1. Shift trees: rebuild BOTH the last-merged upstream commit (the merge-base of HEAD and
#     origin/develop, i.e. the last unmodified upstream state we merged) and the new origin/develop tip
#     under element-web/, matching Haven's own layout.
#  2. Merge with that base explicitly (git merge-recursive <shifted-base> -- HEAD <shifted-tip>) so the
#     three sides share one path prefix and git sees only what upstream really changed between the two
#     upstream states. Merging just the shifted tip instead (the earlier version of this script) let git
#     compare it against the unshifted merge-base, so it re-derived the whole prefix move by rename
#     detection and matched near-identical files (e.g. every module's vitest.config.ts) against each
#     other: 2026-09-21 that produced ~1,100 phantom conflicts for a 132-commit gap, versus 43 real ones
#     with the explicit base.
# No real history is rewritten: the shifted trees are only ever inputs to this one merge, and the merge
# commit is recorded against the real origin/develop tip, not against anything synthetic.
#
# Afterwards, resolve the remaining conflicts by comparing the two upstream states, not just ours vs
# theirs: `git diff <shifted-base> <shifted-tip> -- <path>` is what upstream changed, and
# `git diff <shifted-base> HEAD -- <path>` is what Haven changed. This script prints both tree ids and
# writes the lists of files each side touched, plus the overlap (the files that need a real look), to
# .git/sync-upstream/. Keep Haven's behavior, take upstream's surrounding changes, and check whether
# upstream implemented something Haven had already added before keeping both. See
# [[feedback-auto-sync-upstream-develop]] in Claude's own memory for the known sharp edges: silently
# spliced conflict markers outside a flagged UU, stale string references with no textual conflict,
# pnpm-lock.yaml regeneration, upstream removing a helper Haven still uses, etc.
#
# Only run this on an otherwise-clean working tree - stash or commit first.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Working tree has uncommitted changes - commit or stash them first." >&2
    exit 1
fi

echo "==> Fetching origin/develop"
# --tags: origin's fetch refspec here is scoped to just refs/heads/develop, so git's usual
# auto-follow-reachable-tags behavior doesn't reliably pick up new release tags (e.g. after a
# 2026-08-26 sync, `git describe` reported v1.12.25-273-g... instead of v1.12.26-... purely because
# the v1.12.26 tag itself had never been fetched, even though the commit it points to was).
git fetch --tags origin develop

BASE="$(git merge-base HEAD origin/develop)"
echo "==> Merge-base: $BASE"

UPSTREAM_TIP="$(git rev-parse origin/develop)"

echo "==> Shifting the last-merged upstream state and the new tip under element-web/"
shifted_tree() {
    local tmp_index tree
    tmp_index="$(mktemp -u)"
    GIT_INDEX_FILE="$tmp_index" git read-tree --prefix=element-web/ "$1"
    tree="$(GIT_INDEX_FILE="$tmp_index" git write-tree)"
    rm -f "$tmp_index"
    echo "$tree"
}
BASE_TREE="$(shifted_tree "$BASE")"
TIP_TREE="$(shifted_tree "$UPSTREAM_TIP")"
echo "    shifted base tree: $BASE_TREE"
echo "    shifted tip tree:  $TIP_TREE"

echo "==> Working out what each side changed since the base"
REPORT_DIR="$(git rev-parse --git-dir)/sync-upstream"
mkdir -p "$REPORT_DIR"
echo "$BASE_TREE" > "$REPORT_DIR/base-tree"
echo "$TIP_TREE" > "$REPORT_DIR/tip-tree"
git diff --name-status -M "$BASE_TREE" "$TIP_TREE" > "$REPORT_DIR/upstream-changes.txt"
git diff --name-status -M "$BASE_TREE" HEAD -- element-web > "$REPORT_DIR/haven-changes.txt"
python3 - "$REPORT_DIR" <<'PYEOF'
import sys, os
d = sys.argv[1]
def paths(name):
    out = {}
    for line in open(os.path.join(d, name)):
        parts = line.rstrip("\n").split("\t")
        for p in parts[1:]:
            out[p] = parts[0][0]
    return out
up, hv = paths("upstream-changes.txt"), paths("haven-changes.txt")
both = sorted(set(up) & set(hv))
with open(os.path.join(d, "overlap.txt"), "w") as f:
    for p in both:
        f.write(f"upstream={up[p]} haven={hv[p]}\t{p}\n")
print(f"    upstream changed {len(up)} files, Haven differs from the base in {len(hv)}, both touched {len(both)}")
PYEOF
echo "    (lists in $REPORT_DIR/{upstream-changes,haven-changes,overlap}.txt)"

echo "==> Merging (explicit base)"
git merge-recursive "$BASE_TREE" -- HEAD "$TIP_TREE" || true

# merge-recursive only stages the result; give it a real MERGE_HEAD/MERGE_MSG so a plain 'git commit'
# records a two-parent merge against the actual upstream tip.
echo "$UPSTREAM_TIP" > .git/MERGE_HEAD
printf 'Sync element-web with upstream origin/develop (%s commits)\n' "$(git rev-list --count "$BASE..$UPSTREAM_TIP")" > .git/MERGE_MSG
echo "    MERGE_HEAD set to the real origin/develop ($UPSTREAM_TIP) -"
echo "    resolve conflicts as usual, then a plain 'git commit' will parent correctly."

echo
echo "==> Done (or stopped for conflicts - check git status)."
echo "    After resolving, run scripts/sync-check-lost-lines.py to list Haven-added lines the merge dropped."
echo "    Compare while resolving:  git diff $BASE_TREE $TIP_TREE -- <path>   (what upstream changed)"
echo "                              git diff $BASE_TREE HEAD -- <path>        (what Haven changed)"
