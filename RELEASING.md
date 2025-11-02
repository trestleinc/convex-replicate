# Release Guide

This document explains how to release new versions of ConvexReplicate packages.

## Quick Start

```bash
# Automated release (recommended)
bun run release 0.1.1

# OR manual release (see below)
```

## 🚀 Automated Release Process

The easiest way to release is using the release script:

```bash
# 1. Update CHANGELOG.md with your changes
vim CHANGELOG.md

# 2. Run the release script
bun run release <version>

# Examples:
bun run release 0.1.1  # Patch release
bun run release 0.2.0  # Minor release
bun run release 1.0.0  # Major release
```

The script will:
1. ✅ Validate version format
2. ✅ Check working tree is clean
3. ✅ Update package.json files
4. ✅ Build packages
5. ✅ Commit version bump
6. ✅ Create git tag
7. ✅ Push commits and tag to GitHub
8. ✅ Trigger automated NPM publish

## 📋 Manual Release Process

If you prefer to do it manually:

### Step 1: Update Version Numbers

Edit both package.json files:
- `packages/component/package.json`
- `packages/core/package.json`

Change the `"version"` field to the new version (e.g., `"0.1.1"`).

**OR** use `jq` to automate:

```bash
# Patch version (0.1.0 -> 0.1.1)
jq '.version = "0.1.1"' packages/component/package.json > tmp.json && mv tmp.json packages/component/package.json
jq '.version = "0.1.1"' packages/core/package.json > tmp.json && mv tmp.json packages/core/package.json

# Minor version (0.1.0 -> 0.2.0)
jq '.version = "0.2.0"' packages/component/package.json > tmp.json && mv tmp.json packages/component/package.json
jq '.version = "0.2.0"' packages/core/package.json > tmp.json && mv tmp.json packages/core/package.json

# Major version (0.1.0 -> 1.0.0)
jq '.version = "1.0.0"' packages/component/package.json > tmp.json && mv tmp.json packages/component/package.json
jq '.version = "1.0.0"' packages/core/package.json > tmp.json && mv tmp.json packages/core/package.json
```

### Step 2: Update CHANGELOG.md

Add your changes under a new version heading:

```markdown
## [0.1.1] - 2025-11-02

### Added
- New feature X

### Fixed
- Bug Y

### Changed
- Improved Z
```

Update the links at the bottom:

```markdown
[0.1.1]: https://github.com/trestleinc/convex-replicate/releases/tag/v0.1.1
```

### Step 3: Test Build

```bash
bun run build
```

Ensure everything compiles successfully.

### Step 4: Commit Version Bump

```bash
git add packages/component/package.json packages/core/package.json CHANGELOG.md
git commit -m "chore: Bump version to 0.1.1"
```

### Step 5: Create Git Tag

**IMPORTANT:** Tag must start with `v` to trigger the publish workflow.

```bash
git tag v0.1.1
```

### Step 6: Push to GitHub

```bash
# Push commits first
git push origin replicate  # or your branch name

# Push tag (this triggers the publish workflow)
git push origin v0.1.1
```

### Step 7: Monitor Workflow

1. Go to GitHub Actions: https://github.com/trestleinc/convex-replicate/actions
2. Watch for the "Publish to NPM" workflow
3. Ensure it completes successfully

### Step 8: Verify Publication

Check that packages are published:
- Component: https://www.npmjs.com/package/@convex-replicate/component
- Core: https://www.npmjs.com/package/@convex-replicate/core

Check GitHub release was created:
- https://github.com/trestleinc/convex-replicate/releases

## 📌 Version Numbering (Semantic Versioning)

ConvexReplicate follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features (backward compatible)
- **PATCH** (0.0.1): Bug fixes (backward compatible)

### Examples:

```
0.1.0 -> 0.1.1  (Patch: Bug fix)
0.1.1 -> 0.2.0  (Minor: New feature)
0.9.5 -> 1.0.0  (Major: Breaking change)
```

## 🔧 Troubleshooting

### "Tag already exists"

If you need to re-release:

```bash
# Delete local tag
git tag -d v0.1.1

# Delete remote tag
git push origin :refs/tags/v0.1.1

# Recreate and push
git tag v0.1.1
git push origin v0.1.1
```

### "Working tree is not clean"

Commit or stash your changes:

```bash
git status
git add .
git commit -m "your changes"
```

### Publish workflow failed

Check GitHub Actions logs for errors. Common issues:

1. **NPM_TOKEN expired**: Update secret in GitHub repo settings
2. **Version already published**: Use `--tolerate-republish` (already in workflow)
3. **Build failed**: Fix build errors and try again

### Need to unpublish from NPM

**Warning:** Unpublishing is discouraged. Only do this within 72 hours of publishing:

```bash
npm unpublish @convex-replicate/component@0.1.1
npm unpublish @convex-replicate/core@0.1.1
```

Better approach: Publish a new patch version with the fix.

## 🎯 Best Practices

1. **Always update CHANGELOG.md** before releasing
2. **Test build locally** before pushing tag
3. **Use semantic versioning** correctly
4. **Write clear commit messages** for version bumps
5. **Monitor GitHub Actions** after pushing tag
6. **Verify on NPM** that packages are accessible
7. **Keep both packages in sync** (same version number)

## 🔐 NPM Token Setup

If you need to regenerate the NPM token:

1. Go to https://www.npmjs.com/settings/tokens
2. Create new token (type: Automation)
3. Copy the token
4. Add to GitHub: Settings → Secrets and variables → Actions → New repository secret
5. Name: `NPM_TOKEN`
6. Paste token value

## 📚 Additional Resources

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [NPM Publishing Docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
