# Release Guide

This document explains the automated release process for ConvexReplicate packages using semantic-release.

## Overview

ConvexReplicate uses **semantic-release** with a **main → prod** workflow for SOC2-compliant releases:

- **`main`** branch: Development work
- **`prod`** branch: Production releases (triggers NPM publish)
- **Automated versioning**: Based on conventional commit messages
- **PR-based releases**: All releases go through pull request review

## Quick Start

```bash
# 1. Develop on main with conventional commits
git checkout main
git commit -m "feat: add new feature"
git push origin main

# 2. When ready to release, create PR to prod
gh pr create --base prod --head main --title "Release Sprint 42"

# 3. Review & merge PR in GitHub UI

# 4. Done! Semantic-release automatically:
#    - Determines version from commits
#    - Updates package.json files
#    - Generates CHANGELOG
#    - Publishes to NPM
#    - Creates GitHub release
#    - Opens sync PR back to main
```

## Commit Message Format

ConvexReplicate follows [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning.

### Version Bump Types

- **feat:** → Minor version (0.1.0 → 0.2.0)
- **fix:** → Patch version (0.1.0 → 0.1.1)
- **feat!:** or **BREAKING CHANGE:** → Major version (0.1.0 → 1.0.0)
- **docs:**, **chore:**, **refactor:**, **test:** → No version bump

For full documentation, see the complete guide above.
