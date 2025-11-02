#!/bin/bash

# ConvexReplicate Release Script
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.1.1

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "❌ Error: Version number required"
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.1.1"
  exit 1
fi

# Validate version format (semver)
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Error: Invalid version format"
  echo "Expected: X.Y.Z (e.g., 0.1.1, 1.0.0)"
  exit 1
fi

echo "🚀 Starting release process for v$VERSION"
echo ""

# Check if working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Error: Working tree is not clean"
  echo "Please commit or stash your changes first"
  git status --short
  exit 1
fi

# Check if tag already exists
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "❌ Error: Tag v$VERSION already exists"
  echo "Use a different version number"
  exit 1
fi

echo "📝 Step 1: Updating package.json files..."
jq ".version = \"$VERSION\"" packages/component/package.json > tmp.json && mv tmp.json packages/component/package.json
jq ".version = \"$VERSION\"" packages/core/package.json > tmp.json && mv tmp.json packages/core/package.json
echo "   ✅ Updated component and core versions to $VERSION"
echo ""

echo "📝 Step 2: Updating CHANGELOG.md..."
# Note: You should manually update CHANGELOG.md before running this script
echo "   ⚠️  Don't forget to update CHANGELOG.md with release notes!"
echo "   Press Enter to continue (or Ctrl+C to abort)..."
read
echo ""

echo "📝 Step 3: Building packages..."
bun run build
echo "   ✅ Build successful"
echo ""

echo "📝 Step 4: Committing version bump..."
git add packages/component/package.json packages/core/package.json CHANGELOG.md
git commit -m "chore: Bump version to $VERSION"
echo "   ✅ Committed version bump"
echo ""

echo "📝 Step 5: Creating git tag..."
git tag "v$VERSION"
echo "   ✅ Created tag v$VERSION"
echo ""

echo "📝 Step 6: Pushing to GitHub..."
CURRENT_BRANCH=$(git branch --show-current)
echo "   Pushing branch: $CURRENT_BRANCH"
git push origin "$CURRENT_BRANCH"
echo "   ✅ Pushed commits"
echo ""

echo "   Pushing tag: v$VERSION"
git push origin "v$VERSION"
echo "   ✅ Pushed tag"
echo ""

echo "✨ Release process complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Monitor GitHub Actions: https://github.com/trestleinc/convex-replicate/actions"
echo "   2. Verify on NPM:"
echo "      - https://www.npmjs.com/package/@convex-replicate/component"
echo "      - https://www.npmjs.com/package/@convex-replicate/core"
echo "   3. Check GitHub Release: https://github.com/trestleinc/convex-replicate/releases/tag/v$VERSION"
echo ""
