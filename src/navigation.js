const cheerio = require('cheerio');

function isAccessCheck(html) {
    const $ = cheerio.load(html);
    const heading = `${$('title').text()} ${$('h1').text()} ${$('h2').text()}`;
    return /just a moment|security verification|verify you are human|checking your browser/i.test(heading) ||
        /^www\.royalroad\.com$/i.test($('h1').first().text().trim()) ||
        $('[name="cf-turnstile-response"], #challenge-running, #challenge-form').length > 0;
}

async function loadPage(page, url, selector, {
    timeout = 15000,
    verificationTimeout = 120000,
    showBrowser = process.argv.includes('--show-browser'),
} = {}) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    let html = await page.content();
    if (isAccessCheck(html)) {
        if (showBrowser) {
            console.log('Royal Road requires verification. Complete the check in the browser window; waiting up to two minutes...');
            await page.bringToFront();
        } else {
            console.log('Waiting for Royal Road to finish its access check...');
        }
        try {
            await page.waitForSelector(selector, { timeout: showBrowser ? verificationTimeout : timeout });
        } catch {
            throw new Error(showBrowser
                ? 'Browser verification did not finish. Rerun and complete the Royal Road check in the browser window.'
                : 'Royal Road access check did not finish in the background. Try again later, or use --show-browser to complete it manually.');
        }
        html = await page.content();
    } else {
        if (response && response.status() >= 400) {
            throw new Error(`Royal Road returned HTTP ${response.status()} for ${url}. Try again later.`);
        }
        // Search may legitimately have no matches, and a fiction may have no chapters.
        await page.waitForSelector(selector, { timeout }).catch(error => {
            if (error.name !== 'TimeoutError') throw error;
        });
        html = await page.content();
    }
    if (isAccessCheck(html)) throw new Error('Royal Road is still showing a verification page. Complete the check and rerun.');
    return html;
}

module.exports = { loadPage, isAccessCheck };
