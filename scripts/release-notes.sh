#!/bin/bash
# Release notes for a tag, built from the commit subjects since the previous tag:
# GitHub's own generator only lists pull requests, and commits here land on main.
# Usage: scripts/release-notes.sh v0.2.0   (any ref works, e.g. HEAD to preview)
set -euo pipefail

tag=$1
repo=${GITHUB_REPOSITORY:-$(git remote get-url origin | sed -E 's#.*github\.com[:/]##; s#\.git$##')}
prev=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)
range=${prev:+$prev..}$tag

# A change replaced by another before it was ever released is not news: a later commit in
# the range names it in a "Supersedes: <hash>" trailer, and it is left out.
superseded=" "
for hash in $(git log --format='%(trailers:key=Supersedes,valueonly)' "$range"); do
  superseded+="$(git rev-parse --verify --quiet "$hash^{commit}" || true) "
done

# Commits whose type is $2 become a "## $1" section, with the type prefix
# dropped and the first letter capitalized.
section() {
  local lines
  lines=$(git log -E --grep="^$2(\(.*\))?!?: " --format='%H %s' "$range" |
    while read -r hash subject; do
      [[ $superseded == *" $hash "* ]] || echo "- $subject"
    done | perl -pe 's/^- \w+(\(.*?\))?!?: (.)/"- ".uc($2)/e')
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
