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
# The fix: build a throwaway commit whose tree is origin/develop's current tree, reparented under
# element-web/ (matching Haven's own layout), and merge THAT instead of origin/develop directly.
# Both sides of the merge then use the same path prefix, so git's normal rename detection works
# the way it would in any ordinary repo. This does NOT rewrite any real history - the throwaway
# commit is only ever used as the other side of one merge, never pushed or kept.
#
# Verified 2026-08-26 via `git merge-tree` (a dry-run 3-way merge, no working-tree changes) against
# the same 162-commit gap: CONFLICT (file location) dropped from the dominant conflict type to 5,
# CONFLICT (directory rename split) dropped to 0. What's left afterward is mostly CONFLICT
# (rename/rename) - which for identical content (Haven never touched that file, only its own
# directory-move renamed it once; upstream renamed it again independently, e.g. its own jest ->
# colocated-vitest test migration) is safely auto-resolvable by keeping upstream's new path - plus
# a much smaller set of genuine content conflicts and rename/delete cases that still need a real
# per-file decision. This script does the shift-and-merge only; it does NOT auto-resolve conflicts
# for you - resolve them the same way you would after any other merge (see
# [[feedback-auto-sync-upstream-develop]] in Claude's own memory for the known sharp edges: silently
# spliced conflict markers outside a flagged UU, stale string references with no textual conflict,
# pnpm-lock.yaml regeneration, etc.)
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

echo "==> Building a throwaway commit: origin/develop's tree, shifted under element-web/"
TMP_INDEX="$(mktemp -u)"
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree --prefix=element-web/ origin/develop
SHIFTED_TREE="$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)"
SHIFTED_COMMIT="$(git commit-tree "$SHIFTED_TREE" -m "shifted origin/develop under element-web/ (throwaway, not for history)" -p "$(git rev-parse origin/develop)")"
echo "    Shifted commit: $SHIFTED_COMMIT"

echo "==> Merging"
git merge "$SHIFTED_COMMIT" --no-edit || true

# Swap MERGE_HEAD from the throwaway shifted commit to the real origin/develop tip before anyone
# commits. Without this, `git commit` would record $SHIFTED_COMMIT itself - message and all - as a
# permanent second parent of the merge commit, instead of leaving it truly unreachable as intended.
if [ -f .git/MERGE_HEAD ]; then
    git rev-parse origin/develop > .git/MERGE_HEAD
    echo "    MERGE_HEAD repointed at the real origin/develop ($(git rev-parse origin/develop)) -"
    echo "    resolve conflicts as usual, then a plain 'git commit' will parent correctly."
fi

echo
echo "==> Done (or stopped for conflicts - check git status)."
echo "    Once fully resolved and committed, it's fine that $SHIFTED_COMMIT is unreachable from any"
echo "    branch - it was only ever needed as the other side of this one merge."
