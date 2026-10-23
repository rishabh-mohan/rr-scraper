const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { scrapeChapter } = require('../src/royal-road');
const { createContext } = require('../src/browser');

(async () => {
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
        const context = await createContext(browser);
        const page = await context.newPage();
        assert.equal((await page.evaluate(() => navigator.userAgent)).includes('HeadlessChrome/'), false);
        await page.route('https://fixture.test/**', route => route.fulfill({
            contentType: 'text/html',
            body: '<div class="chapter-inner chapter-content"><p>Visible text</p><p style="display:none">Hidden</p><p style="visibility:hidden">Invisible</p></div>',
        }));
        assert.deepEqual(await scrapeChapter(page, 'https://fixture.test/chapter'), ['Visible text']);
        console.log('Chromium launch and visible paragraph extraction passed.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
