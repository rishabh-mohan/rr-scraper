const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeName } = require('../src/helpers');
const { planFiles } = require('../src/planning');
const { FORMATS, writeAtomic } = require('../src/writers');
const { getNovelMetadata, scrapeChapter } = require('../src/royal-road');
const JSZip = require('jszip');
const { loadPage, isAccessCheck } = require('../src/navigation');

test('verification pages are recognized without inspecting chapter prose', () => {
    assert.equal(isAccessCheck('<h1>www.royalroad.com</h1>'), true);
    assert.equal(isAccessCheck('<title>Just a moment...</title>'), true);
    assert.equal(isAccessCheck('<div class="chapter-content"><p>Verify you are human</p></div>'), false);
});

test('verification can complete before metadata is parsed', async () => {
    let verified = false;
    let broughtToFront = false;
    const page = {
        goto: async () => ({ status: () => 403 }),
        content: async () => verified ? '<div class="fic-header"><h1>Book</h1></div>' : '<h1>www.royalroad.com</h1>',
        bringToFront: async () => { broughtToFront = true; },
        waitForSelector: async () => { verified = true; },
    };
    assert.match(await loadPage(page, 'fixture', '.fic-header', { showBrowser: true }), /Book/);
    assert.equal(broughtToFront, true);
});

test('unresolved verification and HTTP failures report actionable errors', async () => {
    const page = {
        goto: async () => ({ status: () => 403 }),
        content: async () => '<h1>www.royalroad.com</h1>',
        bringToFront: async () => {},
        waitForSelector: async () => { throw new Error('timeout'); },
    };
    await assert.rejects(loadPage(page, 'fixture', '.fic-header', { showBrowser: true }), /verification did not finish/);
    page.bringToFront = async () => { assert.fail('Hidden mode must not show a browser window'); };
    await assert.rejects(loadPage(page, 'fixture', '.fic-header'), /access check did not finish in the background/);
    page.content = async () => '<h1>Service unavailable</h1>';
    page.goto = async () => ({ status: () => 503 });
    await assert.rejects(loadPage(page, 'fixture', '.fic-header'), /HTTP 503/);
});

test('unexpected headings cannot become novel titles', async () => {
    const page = { goto: async () => {}, waitForSelector: async () => {}, content: async () => '<h1>Unexpected page</h1>' };
    await assert.rejects(getNovelMetadata(page, 'fixture'), /recognizable fiction page/);
});

test('filenames stay usable on Windows, including empty and reserved names', () => {
    assert.equal(safeName('CON'), '_CON');
    assert.equal(safeName('///'), 'Untitled');
    assert.equal(safeName(' A: Book. '), 'A Book');
});

test('grouping covers every chapter once, including a short final group', () => {
    const chapters = Array.from({ length: 25 }, (_, i) => ({ index: i + 1, title: 'Chapter' }));
    const files = planFiles(chapters, 10, 'Book');
    assert.deepEqual(files.map(f => f.name), ['Book (01-10)', 'Book (11-20)', 'Book (21-25)']);
    assert.deepEqual(files.flatMap(f => f.group), chapters);
    assert.throws(() => planFiles(chapters, 0, 'Book'));
});

test('metadata deduplicates chapter links and ignores incomplete rows', async () => {
    const page = { goto: async () => {}, waitForSelector: async () => {}, content: async () =>
        '<div class="fic-header"><h1>Book</h1><a href="/profile/1">Writer</a></div><table id="chapters"><tbody>' +
        '<tr><td><a href="/fiction/1/book/chapter/2/one">One</a></td></tr>'.repeat(2) +
        '<tr><td>Missing</td></tr></tbody></table>' };
    const result = await getNovelMetadata(page, 'https://www.royalroad.com/fiction/1/book');
    assert.equal(result.novelTitle, 'Book');
    assert.equal(result.author, 'Writer');
    assert.equal(result.chapters.length, 1);
    assert.equal(result.chapters[0].index, 1);
});

test('empty chapter extraction fails rather than producing an incomplete book', async () => {
    const page = { goto: async () => {}, content: async () => '<div class="chapter-content"></div>', waitForSelector: async () => {}, $$eval: async () => [] };
    await assert.rejects(scrapeChapter(page, 'fixture'), /No visible/);
});

test('all writers create complete exports and failed writes remove partial files', async t => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'rr-scraper-'));
    t.after(() => fs.rm(folder, { recursive: true, force: true }));
    const chapters = [{ title: 'One & <Two>', paragraphs: ['Hello & goodbye.', 'Next paragraph.'] }];
    const meta = { title: 'Book', author: 'Writer' };
    for (const [key, format] of Object.entries(FORMATS)) {
        const target = path.join(folder, 'book' + format.ext);
        await writeAtomic(format, chapters, meta, target);
        const data = await fs.readFile(target);
        assert.ok(data.length > 0);
        await assert.rejects(fs.access(target + '.part'));
        if (key === 'txt') assert.match(data.toString(), /Hello & goodbye/);
        if (key === 'pdf') assert.equal(data.subarray(0, 5).toString(), '%PDF-');
        if (key === 'epub') {
            const zip = await JSZip.loadAsync(data);
            assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
            assert.match(await zip.file('OEBPS/chap_00001.xhtml').async('string'), /One &amp; &lt;Two&gt;/);
            assert.ok(zip.file('OEBPS/content.opf'));
        }
    }
    const target = path.join(folder, 'failure.txt');
    await assert.rejects(writeAtomic({ write: async (_, __, temp) => {
        await fs.writeFile(temp, 'partial');
        throw new Error('disk failure');
    } }, chapters, meta, target), /disk failure/);
    await assert.rejects(fs.access(target));
    await assert.rejects(fs.access(target + '.part'));
});
