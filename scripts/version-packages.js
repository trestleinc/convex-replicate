#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Version argument required');
  process.exit(1);
}

const packages = ['packages/component/package.json', 'packages/core/package.json'];

packages.forEach((pkgPath) => {
  const fullPath = path.join(process.cwd(), pkgPath);
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Updated ${pkgPath} to version ${version}`);
});
