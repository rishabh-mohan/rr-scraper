const { chromium } = require('playwright');
const { isAccessCheck } = require('../src/navigation');
const { createContext } = require('../src/browser');
const { getNovelMetadata, scrapeChapter } = require('../src/royal-road');

(async () => {
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
        const context = await createContext(browser);
        const page = await context.newPage();
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}', route => route.abort());
        const response = await page.goto('https://www.royalroad.com/fiction/98748/infinite-farmer-a-plants-vs-dungeon-litrpg', { waitUntil: 'domcontentloaded' });
        console.log('Initial:', response.status(), await page.title(), 'access check:', isAccessCheck(await page.content()));
        await page.waitForSelector('.fic-header h1', { timeout: 20000 }).catch(() => {});
        console.log('After waiting:', await page.title(), 'access check:', isAccessCheck(await page.content()));
        console.log('Heading:', await page.locator('h1').allTextContents());
        console.log('Chapters:', await page.locator('#chapters tbody tr').count());
        if (!isAccessCheck(await page.content())) {
            const novel = await getNovelMetadata(page, page.url());
            console.log('Parsed fiction:', novel.novelTitle, 'chapters:', novel.chapters.length);
            if (novel.chapters.length) {
                const paragraphs = await scrapeChapter(page, novel.chapters[0].url);
                console.log('First chapter visible paragraphs:', paragraphs.length);
            }
        } else {
            process.exitCode = 1;
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
