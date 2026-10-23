const { chromium } = require('playwright');
const { createContext } = require('./browser');
const fs = require('node:fs');
const path = require('node:path');
const { ask, safeName, sleep, withRetry, openFolder } = require('./helpers');
const { searchRoyalRoad, getNovelMetadata, scrapeChapter } = require('./royal-road');
const { askFormat, askChaptersPerFile } = require('./prompts');
const { planFiles } = require('./planning');
const { writeAtomic } = require('./writers');

async function run() {
    const userInput = await ask('Enter RoyalRoad URL OR Search Title: ');

    if (!userInput) throw new Error('Enter a fiction URL or title.');
    if (/^https?:/i.test(userInput)) {
        const url = new URL(userInput);
        if (!['www.royalroad.com', 'royalroad.com'].includes(url.hostname) || !/^\/fiction\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname)) {
            throw new Error('Use a Royal Road fiction URL, not a chapter URL.');
        }
    }

    const browser = await chromium.launch({
        channel: 'chromium',
        headless: !process.argv.includes('--show-browser'),
    });
    try {
        const context = await createContext(browser);
        const page = await context.newPage();
        // Block images/fonts only. Blocking stylesheets can break layout-dependent
        // checks (like the hidden-paragraph filter) if RR ever moves that CSS external.
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}', (route) => route.abort());

        let fictionUrl;
        if (/^https?:\/\//i.test(userInput)) {
            fictionUrl = userInput;
        } else {
            const results = await searchRoyalRoad(page, userInput);
            if (results.length === 0) {
                process.exitCode = 1;
                console.log('❌ No novels found matching that title.');
                return;
            }

            console.log('\nTop Search Results:');
            for (const r of results) {
                console.log(`  [${r.index}] ${r.title} (${r.chapters} ch | ★ ${r.rating})`);
            }

            const choice = parseInt(await ask('\nPick a number (default 1): '), 10);
            const selected = results[choice - 1] || results[0];
            console.log(`\nSelected: "${selected.title}"`);
            fictionUrl = selected.url;
        }

        const { novelTitle, author, chapters } = await getNovelMetadata(page, fictionUrl);
        console.log(`\nNovel Title: "${novelTitle}"`);
        console.log(`Found ${chapters.length} total chapters!`);
        if (chapters.length === 0) {
            process.exitCode = 1;
            console.log('No chapters found.');
            return;
        }

        const format = await askFormat();
        const perFile = await askChaptersPerFile(chapters.length);
        const files = planFiles(chapters, perFile, novelTitle);
        console.log(`\nSaving as ${format.label}: ${files.length} file(s), up to ${perFile} chapter(s) each.`);

        const folder = path.join(__dirname, '..', 'downloads', `${safeName(novelTitle)} (${new URL(fictionUrl).pathname.split('/')[2]})`);
        fs.mkdirSync(folder, { recursive: true });
        console.log(`📁 Output directory:\n ${folder}`);

        const failedFiles = [];

        for (let f = 0; f < files.length; f++) {
            const { group, name } = files[f];
            const fileName = `${name}${format.ext}`;
            const filePath = path.join(folder, fileName);
            const first = group[0].index;
            const last = group[group.length - 1].index;
            const range = first === last ? `chapter ${first}` : `chapters ${first}-${last}`;

            console.log('---------------------------------');
            if (fs.existsSync(filePath)) {
                console.log(`[file ${f + 1}/${files.length}] Already exists, skipping: ${fileName}`);
                continue;
            }
            console.log(`[file ${f + 1}/${files.length}] ${fileName} (${range})`);

            const collected = [];
            let failed = false;

            for (const chapter of group) {
                console.log(`  [${chapter.index}/${chapters.length}] Scraping: ${chapter.title}`);
                try {
                    const paragraphs = await withRetry(chapter.title, () => scrapeChapter(page, chapter.url));
                    collected.push({ title: chapter.title, paragraphs });
                } catch (err) {
                    console.error(`  ✖ Giving up on "${chapter.title}": ${err.message}`);
                    failed = true;
                    break;
                }
                await sleep(300 + Math.random() * 700);
            }

            // A network failure aborts the file so a re-run retries the whole group,
            // instead of silently saving a file with missing chapters.
            if (failed) {
                failedFiles.push(fileName);
                console.error(`  ✖ ${fileName} not written. Re-run to retry it.`);
                continue;
            }
            if (collected.length === 0) {
                console.warn(`  ⚠ No content for ${fileName}, nothing written.`);
                continue;
            }

            try {
                await writeAtomic(format, collected, { title: novelTitle, author }, filePath);
                console.log(`Saved: ${fileName}`);
            } catch (err) {
                failedFiles.push(fileName);
                console.error(`  ✖ Could not write ${fileName}: ${err.message}`);
            }
        }

        if (failedFiles.length > 0) {
            console.log(`\n⚠ ${failedFiles.length} file(s) failed (re-run to retry):`);
            process.exitCode = 1;
            failedFiles.forEach((n) => console.log(`  - ${n}`));
        }
        console.log(`\nCompleted! Output folder:\n📁 ${folder}`);
        openFolder(folder);
    } catch (err) {
        throw err;
    } finally {
        await browser.close();
    }
}

module.exports = { run };
