const cheerio = require('cheerio');
const fs = require('node:fs');
const { clean, toAbsolute } = require('./helpers');
const { loadPage } = require('./navigation');
const BASE = 'https://www.royalroad.com';
const DEBUG = process.env.DEBUG === '1';

function parseChapterCount($, el) {
    // Case 1: "1,234 Chapters" in one text run
    const m = clean($(el).text()).match(/([\d,]+)\s+Chapters?\b/i);
    if (m) return m[1];

    // Case 2: number and label are sibling elements (<div>1,234</div><div>Chapters</div>)
    let found = null;
    $(el).find('*').each((_, node) => {
        const $n = $(node);
        if ($n.children().length === 0 && /^chapters?$/i.test(clean($n.text()))) {
            const prev = clean($n.prev().text());
            if (/^[\d,]+$/.test(prev)) {
                found = prev;
                return false;
            }
        }
    });
    return found || 'n/a';
}

function parseRating($, el) {
    const $el = $(el);
    const ratingRe = /(?<![\d.])(\d(?:\.\d{1,2})?)\s*(?:out of 5|\/\s*5|stars?)/i;
    const candidates = [];

    // Tooltips / aria / title / data attributes are where RR tends to hide the number
    $el.find('[aria-label],[title],[data-content],[data-original-title],[data-rr-tooltip-content],[role="tooltip"]')
        .each((_, n) => {
            const $n = $(n);
            for (const attr of ['aria-label', 'title', 'data-content', 'data-original-title', 'data-rr-tooltip-content']) {
                const v = $n.attr(attr);
                if (v) candidates.push(v);
            }
            candidates.push($n.text());
        });
    candidates.push($el.html() || ''); // last resort: raw markup

    for (const c of candidates) {
        const m = clean(c).match(ratingRe);
        if (m) return `${m[1]}/5`;
    }
    return /too few ratings/i.test($el.text()) ? 'Too few ratings' : 'no rating';
}

async function searchRoyalRoad(page, query) {
    const url = `${BASE}/fictions/search?title=${encodeURIComponent(query)}&globalFilters=true`;
    console.log(`\nSearching Royal Road for "${query}"...`);

    const html = await loadPage(page, url, 'a[href*="/fiction/"]');
    if (DEBUG) {
        fs.writeFileSync('debug_search.html', html);
        console.log('  (wrote debug_search.html)');
    }

    const $ = cheerio.load(html);
    const results = [];

    $('.fiction-list-item, .fiction-card-expanded').slice(0, 5).each((_, el) => {
        const $link = $(el).find('h2 a, a:has(h2)').first();
        const href = $link.attr('href') || $(el).find('a[href*="/fiction/"]').first().attr('href');
        const title = clean($(el).find('h2').first().text());
        if (!title || !href) return;

        results.push({
            index: results.length + 1,
            title,
            chapters: parseChapterCount($, el),
            rating: parseRating($, el),
            url: toAbsolute(href),
        });
    });

    return results;
}

// ---------- fiction + chapter pages ----------

async function getNovelMetadata(page, fictionUrl) {
    console.log(`\nFetching metadata from: ${fictionUrl}`);
    const html = await loadPage(page, fictionUrl, '#chapters tbody tr');
    if (DEBUG) fs.writeFileSync('debug_fiction.html', html);
    const $ = cheerio.load(html);

    const novelTitle = clean($('.fic-header h1').first().text());
    if (!novelTitle) throw new Error('Royal Road did not return a recognizable fiction page. Try again or inspect the page with DEBUG=1.');

    const author =
        clean($('.fic-header a[href^="/profile/"]').first().text()) ||
        clean($('meta[property="books:author"]').attr('content')) ||
        'Unknown';

    const chapters = [];
    const seen = new Set();
    $('#chapters tbody tr').each((_, row) => {
        const $link = $(row).find('td:first-child a').first();
        const href = $(row).attr('data-url') || $link.attr('href');
        const title = clean($link.text());
        if (!href || !title) return;

        const url = toAbsolute(href);
        if (seen.has(url)) return;
        seen.add(url);

        // index from chapters.length so skipped rows don't leave gaps
        chapters.push({ index: chapters.length + 1, title, url });
    });

    return { novelTitle, author, chapters };
}

async function scrapeChapter(page, url) {
    await loadPage(page, url, '.chapter-inner.chapter-content');

    // Evaluate in the browser so we can skip paragraphs hidden via CSS
    // (RR injects hidden anti-piracy paragraphs that cheerio would happily include).
    const paragraphs = await page.$$eval('.chapter-inner.chapter-content p', (ps) =>
        ps
            .filter((p) => {
                const s = getComputedStyle(p);
                return s.display !== 'none' && s.visibility !== 'hidden';
            })
            .map((p) => p.innerText.trim())
            .filter(Boolean)
    );
    if (!paragraphs.length) throw new Error('No visible chapter paragraphs found');
    return paragraphs;
}


module.exports = { searchRoyalRoad, getNovelMetadata, scrapeChapter };
