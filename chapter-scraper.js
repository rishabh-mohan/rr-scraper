const cheerio = require('cheerio');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const JSZip = require('jszip');
const { randomUUID } = require('crypto');
const readline = require('readline/promises');
const { spawn } = require('child_process');

const BASE = 'https://www.royalroad.com';
const DEBUG = process.env.DEBUG === '1'; // DEBUG=1 node script.js -> dumps HTML for inspection
const MAX_RETRIES = 3;

/* 
* bug: books with the same title are saved in the same folder.
*   I am not sure on how to fix this, especially because the author could
*       change markers that would be unique to each book, like
*       chapter title. I also don't want to store the book's UID,
*       so I'm a little lost on this.
* plans:
*   [ ] eventually add to website
*   [ ] rather than search, add little website popup of RR, open book,
*           and press "scrape", Endgoal of this project.
*   [ ] make pdf and epub look nicer 
* 
*/
// ---------- helpers ----------

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const toAbsolute = (href) => new URL(href, BASE).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeName(s, max = 120) {
    return s
        .replace(/[\r\n]+/g, '')
        .replace(/[/\\?%*:|"<>]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '') // Windows dislikes trailing dots/spaces
        .slice(0, max);
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
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => {}); // don't crash if the opener isn't available
        child.unref();
    } catch {
        console.log(`Open manually: ${target}`);
    }
}

// ---------- search page parsing ----------

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

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a[href*="/fiction/"]', { timeout: 15000 }).catch(() => {});

    const html = await page.content();
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
    await page.goto(fictionUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#chapters tbody tr', { timeout: 15000 }).catch(() => {});

    const html = await page.content();
    if (DEBUG) fs.writeFileSync('debug_fiction.html', html);
    const $ = cheerio.load(html);

    const novelTitle = clean($('.fic-header h1').first().text()) || clean($('h1').first().text()) || `Novel_${Date.now()}`;

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
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chapter-inner.chapter-content', { timeout: 15000 });

    // Evaluate in the browser so we can skip paragraphs hidden via CSS
    // (RR injects hidden anti-piracy paragraphs that cheerio would happily include).
    return page.$$eval('.chapter-inner.chapter-content p', (ps) =>
        ps
            .filter((p) => {
                const s = getComputedStyle(p);
                return s.display !== 'none' && s.visibility !== 'hidden';
            })
            .map((p) => p.innerText.trim())
            .filter(Boolean)
    );
}

// ---------- output writers ----------
// All writers share one signature:
//   (chapters[{ title, paragraphs }], { title, author }, filePath) => Promise<void>
// A file can hold one chapter or many; each chapter starts on its own page/section.

function sanitizeText(text) {
    return text
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u2014/g, '--')
        .replace(/\u2013/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u2022/g, '*')
        .replace(/[\u00a0\u2009\u200a]/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '');
}

function writePDF(chapters, meta, filePath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            margin: 50,
            info: { Title: sanitizeText(meta.title), Author: sanitizeText(meta.author) },
        });
        const stream = fs.createWriteStream(filePath);
        stream.on('finish', resolve);
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);

        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;

        chapters.forEach((ch, i) => {
            if (i > 0) doc.addPage();
            const title = sanitizeText(ch.title);
            doc.outline.addItem(title); // PDF bookmarks, handy in multi-chapter files

            doc.fillColor('#2c3e50').fontSize(20).text(title, { align: 'center' });
            doc.moveDown(0.5);
            doc.strokeColor('#bdc3c7').lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
            doc.moveDown(1.5);

            doc.fillColor('#333333').fontSize(11).lineGap(5);
            for (const p of ch.paragraphs) {
                doc.text(sanitizeText(p), { align: 'left', paragraphGap: 12 });
            }
        });
        doc.end();
    });
}

async function writeTXT(chapters, meta, filePath) {
    // Plain UTF-8: curly quotes etc. are fine in text files, so no sanitizing.
    const parts = chapters.map((ch) => {
        const underline = '='.repeat(Math.min(ch.title.length, 80));
        return `${ch.title}\n${underline}\n\n${ch.paragraphs.join('\n\n')}`;
    });
    await fs.promises.writeFile(filePath, parts.join('\n\n\n') + '\n', 'utf8');
}

function escapeXml(s) {
    return s
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '') // invalid in XML 1.0
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Builds an EPUB 3 (with an EPUB 2 NCX for older readers) by hand using JSZip,
// so there's no unmaintained epub library involved.
async function writeEPUB(chapters, meta, filePath) {
    const bookId = `urn:uuid:${randomUUID()}`;
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const title = escapeXml(meta.title);
    const author = escapeXml(meta.author);
    const items = chapters.map((c, i) => ({
        id: `chap${i + 1}`,
        href: `chap_${String(i + 1).padStart(5, '0')}.xhtml`,
        title: escapeXml(c.title),
        paragraphs: c.paragraphs,
    }));

    const xhtml = (inner, t) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${t}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${inner}
</body>
</html>`;

    const zip = new JSZip();
    // createFolders:false avoids empty directory entries, which some validators flag.
    const add = (name, data, opts = {}) => zip.file(name, data, { createFolders: false, ...opts });
    // The mimetype entry must come first and be stored uncompressed.
    add('mimetype', 'application/epub+zip', { compression: 'STORE' });

    add('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    add('OEBPS/style.css', `body { font-family: serif; line-height: 1.5; margin: 5%; }
h1 { text-align: center; margin: 1.5em 0 1em; font-size: 1.6em; }
p { margin: 0 0 1em; text-indent: 0; }
`);

    for (const it of items) {
        const body = `<h1>${it.title}</h1>\n` + it.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('\n');
        add(`OEBPS/${it.href}`, xhtml(body, it.title));
    }

    add('OEBPS/nav.xhtml', xhtml(
        `<nav epub:type="toc" id="toc"><h1>Contents</h1>\n<ol>\n` +
        items.map((it) => `<li><a href="${it.href}">${it.title}</a></li>`).join('\n') +
        `\n</ol></nav>`, 'Contents'));

    add('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${items.map((it, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${it.title}</text></navLabel><content src="${it.href}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>`);

    add('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:publisher>Royal Road</dc:publisher>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${items.map((it) => `    <item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${items.map((it) => `    <itemref idref="${it.id}"/>`).join('\n')}
  </spine>
</package>`);

    const buf = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        mimeType: 'application/epub+zip',
    });
    await fs.promises.writeFile(filePath, buf);
}

const FORMATS = {
    txt: { label: 'TXT', ext: '.txt', write: writeTXT },
    pdf: { label: 'PDF', ext: '.pdf', write: writePDF },
    epub: { label: 'EPUB', ext: '.epub', write: writeEPUB },
};

// Write to "<file>.part" then rename, so an interrupted run never leaves a
// half-written file that the resume check would mistake for a finished one.
async function writeAtomic(format, chapters, meta, filePath) {
    const tmp = `${filePath}.part`;
    try {
        await format.write(chapters, meta, tmp);
        fs.renameSync(tmp, filePath);
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
}

// ---------- prompts ----------

async function askFormat() {
    const keys = Object.keys(FORMATS);
    const menu = keys.map((k, i) => `[${i + 1}] ${FORMATS[k].label}`).join('  ');

    while (true) {
        const answer = (await ask(`\nSave format: ${menu} (default 2): `)).toLowerCase();

        let key;
        if (answer === '') key = 'pdf';
        else if (/^\d+$/.test(answer)) key = keys[parseInt(answer, 10) - 1];
        else key = keys.find((k) => k === answer);

        if (key) return FORMATS[key];
        console.log('  Invalid choice, try again.');
    }
}

async function askChaptersPerFile(total) {
    while (true) {
        const answer = (await ask(`\nChapters per file (default all, "all" = every chapter): `)).toLowerCase();

        if (answer === '') return total;
        if (answer === 'all' || answer === '0') return total;
        if (/^\d+$/.test(answer) && parseInt(answer, 10) > 0) return Math.min(parseInt(answer, 10), total);
        console.log('  Enter a positive number, or "all".');
    }
}

// ---------- file planning ----------

function planFiles(chapters, perFile, novelTitle) {
    const pad = (n) => String(n).padStart(String(chapters.length).length, '0');
    const base = safeName(novelTitle);
    const files = [];

    for (let i = 0; i < chapters.length; i += perFile) {
        const group = chapters.slice(i, i + perFile);
        const first = group[0].index;
        const last = group[group.length - 1].index;

        let name;
        if (perFile === 1) name = `${pad(first)}_${safeName(group[0].title)}`;
        else if (group.length === chapters.length) name = base; // everything in one file
        else if (first === last) name = `${base} (${pad(first)})`;
        else name = `${base} (${pad(first)}-${pad(last)})`;

        files.push({ group, name });
    }
    return files;
}

// ---------- main ----------

async function run() {
    const userInput = await ask('Enter RoyalRoad URL OR Search Title: ');

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
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
            console.log('No chapters found.');
            return;
        }

        const format = await askFormat();
        const perFile = await askChaptersPerFile(chapters.length);
        const files = planFiles(chapters, perFile, novelTitle);
        console.log(`\nSaving as ${format.label}: ${files.length} file(s), up to ${perFile} chapter(s) each.`);

        const folder = path.join(__dirname, safeName(novelTitle));
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
                    if (paragraphs.length === 0) {
                        console.warn('  ⚠ No paragraphs found, leaving this chapter out.');
                    } else {
                        collected.push({ title: chapter.title, paragraphs });
                    }
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
            failedFiles.forEach((n) => console.log(`  - ${n}`));
        }
        console.log(`\nCompleted! Output folder:\n📁 ${folder}`);
        openFolder(folder);
    } catch (err) {
        console.error('Fatal execution error:', err);
    } finally {
        await browser.close();
    }
}

run();
