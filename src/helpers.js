const path = require('node:path');
const readline = require('node:readline/promises');
const { spawn } = require('node:child_process');
const BASE = 'https://www.royalroad.com';
const MAX_RETRIES = 3;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const toAbsolute = (href) => new URL(href, BASE).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeName(s, max = 120) {
    const name = (s || 'Untitled')
        .replace(/[\r\n]+/g, '')
        .replace(/[/\\?%*:|"<>]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '') // Windows dislikes trailing dots/spaces
        .slice(0, max).replace(/[. ]+$/, '') || 'Untitled';
    return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? '_' + name : name;
}

async function ask(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(query)).trim();
    } finally {
        rl.close();
    }
}

async function withRetry(label, fn) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            console.warn(`  ⚠ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
            if (attempt === MAX_RETRIES) throw err;
            await sleep(1000 * attempt);
        }
    }
}

function openFolder(folder) {
    const target = path.resolve(folder);
    const [cmd, args] =
        process.platform === 'win32' ? ['explorer.exe', [target]]
        : process.platform === 'darwin' ? ['open', [target]]
        : ['xdg-open', [target]];

    try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {}); // don't crash if the opener isn't available
        child.unref();
    } catch {
        console.log(`Open manually: ${target}`);
    }
}


module.exports = { clean, toAbsolute, sleep, safeName, ask, withRetry, openFolder };
