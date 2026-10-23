#!/usr/bin/env node
// This entry point uses only Node built-ins until setup has completed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function command(program, args) {
    const result = spawnSync(program, args, { cwd: __dirname, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Setup command failed. Check your internet connection and the messages above, then run again.');
}

async function main() {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
    if (process.argv.includes('--help')) {
        console.log('Run: node chapter-scraper.js\nFirst run installs dependencies and Chromium automatically.\n--setup     Install only, without starting prompts.\n--show-browser  Show the browser for manual verification.\n--help      Show this message.');
        return;
    }
    const manifest = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    const marker = path.join(__dirname, 'node_modules', '.rr-scraper-setup');
    let installed = false;
    try { installed = fs.readFileSync(marker, 'utf8') === manifest; } catch {}
    if (!installed) {
        console.log('Installing application dependencies (first run)...');
        if (process.platform === 'win32') command('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund']);
        else command('npm', ['ci', '--no-audit', '--no-fund']);
    }
    const { chromium } = require('playwright');
    if (!fs.existsSync(chromium.executablePath())) {
        console.log('Downloading Chromium (first run)...');
        command(process.execPath, [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'install', 'chromium']);
    }
    fs.writeFileSync(marker, manifest);
    if (!process.argv.includes('--setup')) await require('./src/app').run();
}

main().catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
});

