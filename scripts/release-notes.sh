#!/bin/bash
# Release notes for a tag, built from the commit subjects since the previous tag:
# GitHub's own generator only lists pull requests, and commits here land on main.
# Usage: scripts/release-notes.sh v0.2.0   (any ref works, e.g. HEAD to preview)
set -euo pipefail

tag=$1
repo=${GITHUB_REPOSITORY:-$(git remote get-url origin | sed -E 's#.*github\.com[:/]##; s#\.git$##')}
prev=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)
range=${prev:+$prev..}$tag

# Commits whose type is $2 become a "## $1" section, with the type prefix
# dropped and the first letter capitalized.
section() {
  local lines
  lines=$(git log -E --grep="^$2(\(.*\))?!?: " --format='- %s' "$range" | perl -pe 's/^- \w+(\(.*?\))?!?: (.)/"- ".uc($2)/e')
  if [ -n "$lines" ]; then
    printf '## %s\n\n%s\n\n' "$1" "$lines"
  fi
}

section New feat
section Fixed fix
if [ -n "$prev" ]; then
  echo "**Full changelog**: https://github.com/$repo/compare/$prev...$tag"
else
  echo "**Full changelog**: https://github.com/$repo/commits/$tag"
fi
