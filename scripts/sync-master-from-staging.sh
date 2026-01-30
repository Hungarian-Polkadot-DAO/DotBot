#!/bin/bash
# Script to sync master with staging when content is identical but histories differ
# This creates a clean PR that syncs histories without showing 114 old commits

set -e

echo "🔄 Creating sync PR from staging to master..."

# Fetch latest
git fetch origin

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)

# Create a new branch from origin/master
SYNC_BRANCH="sync-master-from-staging-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$SYNC_BRANCH" origin/master

# Check if there are actual differences
if git diff --quiet origin/master staging; then
    echo "✅ origin/master and staging are already in sync (no file differences)"
    echo "But they have different commit histories."
    echo ""
    echo "Creating a merge commit with 'ours' strategy to sync histories..."
    echo "This will create a merge commit that says 'master includes staging'"
    echo "without changing any files (since they're already identical)."
    echo ""
    
    # Use 'ours' merge strategy - this creates a merge commit without changing files
    git merge -s ours staging -m "Sync master with staging (identical content, different histories)

This merge syncs the commit histories of master and staging.
The file contents are already identical, so no files are changed.
This prevents future PRs from showing 114 duplicate commits.

Generated: $(date +%Y-%m-%d)"
    
    echo ""
    echo "✅ Created sync merge commit on branch: $SYNC_BRANCH"
else
    echo "📦 Content differs between master and staging"
    echo "Applying changes from staging..."
    
    # Get all changes from staging
    git checkout staging -- .
    git add -A
    
    if ! git diff --cached --quiet; then
        git commit -m "Sync master with staging: $(date +%Y-%m-%d)

This commit brings master up to date with staging.
All changes from staging have been applied in a single commit."
        
        echo "✅ Created sync commit with changes"
    else
        echo "✅ No changes to apply (already in sync)"
    fi
fi

echo ""
echo "✅ Created sync branch: $SYNC_BRANCH"
echo ""
echo "Next steps:"
echo "1. Push the branch: git push origin $SYNC_BRANCH"
echo "2. Create a PR from $SYNC_BRANCH to master on GitHub"
echo "3. The PR will show only 1 commit (this sync commit)"
echo "4. Merge the PR - it will have no conflicts since content is identical"
echo ""
echo "To push now, run:"
echo "  git push origin $SYNC_BRANCH"
