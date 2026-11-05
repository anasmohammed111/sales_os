#!/usr/bin/env node
// Builds the CRM and the Kelto admin app into one Vercel output:
// dist/staged/ holds the CRM, dist/staged/admin/ holds the admin app.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const staged = path.join(dist, 'staged');

execSync('npx ng build', { stdio: 'inherit' });
execSync('npx ng build kelto-admin', { stdio: 'inherit' });

fs.rmSync(staged, { recursive: true, force: true });
// Each app's files go at the top of its path: index.html asks for /main-*.js and /admin/main-*.js
fs.cpSync(path.join(dist, 'sales-follow-up-web', 'browser'), staged, { recursive: true });
fs.cpSync(path.join(dist, 'kelto-admin', 'browser'), path.join(staged, 'admin'), { recursive: true });

console.log('Staged the CRM at dist/staged and the admin app at dist/staged/admin');
