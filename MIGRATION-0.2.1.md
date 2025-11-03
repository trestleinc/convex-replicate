# Migration Guide: v0.2.0 → v0.2.1

## Breaking Changes: Automerge as Peer Dependency

Version 0.2.1 moves Automerge from being bundled to a peer dependency, resulting in smaller package sizes and better compatibility.

## Why This Change?

**Before (v0.2.x):**
- ❌ Automerge was bundled into the core package (~150KB)
- ❌ WASM files required manual handling
- ❌ Users couldn't control Automerge version
- ❌ Potential for duplicate Automerge instances

**After (v0.2.1):**
- ✅ Automerge is a peer dependency (~65KB package)
- ✅ User's bundler handles WASM files automatically
- ✅ Users control Automerge version
- ✅ Single Automerge instance across your app
- ✅ 57% smaller package size

## Quick Migration

### Step 1: Install Automerge Dependencies

**Using Bun (Automatic):**
Bun automatically installs peer dependencies, so just upgrade the packages:

\`\`\`bash
bun add @trestleinc/convex-replicate-core@^0.2.1 @trestleinc/convex-replicate-component@^0.2.1
# Automerge peer dependencies are installed automatically! ✨
\`\`\`

**Using npm/yarn/pnpm (Manual):**
You must explicitly install peer dependencies:

\`\`\`bash
# npm
npm install @automerge/automerge @automerge/automerge-repo-storage-indexeddb

# yarn
yarn add @automerge/automerge @automerge/automerge-repo-storage-indexeddb

# pnpm
pnpm add @automerge/automerge @automerge/automerge-repo-storage-indexeddb
\`\`\`

### Step 2: Update Your package.json

\`\`\`json
{
  "dependencies": {
    "@automerge/automerge": "^3.1.2",
    "@automerge/automerge-repo-storage-indexeddb": "^2.4.0",
    "@trestleinc/convex-replicate-core": "^0.2.1",
    "@trestleinc/convex-replicate-component": "^0.2.1"
  }
}
\`\`\`

### Step 3: No Code Changes Required!

Your application code remains the same. Convex Replicate still imports and uses Automerge internally.

## Benefits

### Smaller Package Size

\`\`\`
Before: @trestleinc/convex-replicate-core → 150KB
After:  @trestleinc/convex-replicate-core → 65KB

Reduction: -57% (85KB saved) 🎉
\`\`\`

### Better Bundler Compatibility

Your bundler (Vite, Webpack, etc.) now handles:
- ✅ WASM file loading
- ✅ Import resolution
- ✅ Code splitting
- ✅ Tree shaking

### Version Control

You can now:
- ✅ Update Automerge independently
- ✅ Lock to specific Automerge versions
- ✅ Test new Automerge features without waiting for Convex Replicate update

## Troubleshooting

### Error: Cannot find module '@automerge/automerge'

**Solution:** Install Automerge as shown in Step 1 above.

### TypeScript Errors

**Solution:** Ensure your `package.json` includes both Automerge packages:
\`\`\`json
{
  "dependencies": {
    "@automerge/automerge": "^3.1.2",
    "@automerge/automerge-repo-storage-indexeddb": "^2.4.0"
  }
}
\`\`\`

### WASM Loading Issues

If you encounter WASM loading errors, ensure your bundler is configured to handle WASM files. For Vite, this is automatic. For other bundlers, check their documentation.

## Need Help?

If you encounter issues during migration, please open an issue at:
https://github.com/trestleinc/convex-replicate/issues
