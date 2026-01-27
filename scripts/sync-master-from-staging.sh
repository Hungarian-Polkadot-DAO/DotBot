#!/bin/bash
# Script to sync master with staging using squash merge
# This prevents PR conflicts by keeping master's history clean

set -e

echo "🔄 Syncing master with staging..."

# Ensure we're on master
git checkout master
git pull origin master

# Create a temporary branch for the squash merge
TEMP_BRANCH="sync-master-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$TEMP_BRANCH"

# Reset to master (clean slate)
git reset --soft master

# Get all changes from staging
git checkout staging -- .

# Create a single commit with all changes
git add -A
git commit -m "Sync master with staging: $(date +%Y-%m-%d)

This commit brings master up to date with staging.
All changes from staging have been squashed into this single commit."

echo "✅ Created sync commit on branch: $TEMP_BRANCH"
echo ""
echo "Next steps:"
echo "1. Review the changes: git diff master $TEMP_BRANCH"
echo "2. Push the branch: git push origin $TEMP_BRANCH"
echo "3. Create a PR from $TEMP_BRANCH to master"
echo "4. Merge the PR (this will be a clean merge)"
echo ""
echo "Or, if you want to merge directly (not recommended for shared branches):"
echo "  git checkout master"
echo "  git merge --squash $TEMP_BRANCH"
echo "  git commit -m 'Sync master with staging'"
echo "  git push origin master"
