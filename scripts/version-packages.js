#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
if (!version) {
  // biome-ignore lint/suspicious/noConsole: CLI script needs console output
  console.error('Version argument required');
  process.exit(1);
}

const packages = ['packages/component/package.json', 'packages/core/package.json'];

packages.forEach((pkgPath) => {
  const fullPath = path.join(process.cwd(), pkgPath);
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`);
  // biome-ignore lint/suspicious/noConsole: CLI script needs console output
  console.log(`Updated ${pkgPath} to version ${version}`);
});
