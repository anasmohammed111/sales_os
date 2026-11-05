#!/usr/bin/env node
// Build both apps and stage them for Vercel deployment

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const staged = path.join(dist, 'staged');

console.log('Building main CRM app...');
execSync('npx ng build', { stdio: 'inherit' });

console.log('Building admin app...');
execSync('npx ng build kelto-admin', { stdio: 'inherit' });

console.log('Staging apps for Vercel...');
if (!fs.existsSync(staged)) fs.mkdirSync(staged, { recursive: true });

// Copy main app to root
const mainBrowser = path.join(dist, 'sales-follow-up-web', 'browser');
const stagedMain = path.join(staged, 'browser');
if (fs.existsSync(stagedMain)) fs.rmSync(stagedMain, { recursive: true });
fs.cpSync(mainBrowser, stagedMain, { recursive: true });
console.log('✓ Main app staged at dist/staged/browser');

// Copy admin app to /admin
const adminBrowser = path.join(dist, 'kelto-admin', 'browser');
const stagedAdmin = path.join(staged, 'admin', 'browser');
if (fs.existsSync(stagedAdmin)) fs.rmSync(stagedAdmin, { recursive: true });
fs.mkdirSync(path.dirname(stagedAdmin), { recursive: true });
fs.cpSync(adminBrowser, stagedAdmin, { recursive: true });
console.log('✓ Admin app staged at dist/staged/admin/browser');

// Copy 3rdparty licenses
const crmLicenses = path.join(dist, 'sales-follow-up-web', '3rdpartylicenses.txt');
if (fs.existsSync(crmLicenses)) {
  fs.cpSync(crmLicenses, path.join(stagedMain, '3rdpartylicenses.txt'));
}

console.log('✓ Build complete. Ready for Vercel deployment.');
