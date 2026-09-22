const cheerio = require('cheerio');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
/* TODO
*   Add search feature
*   understand whatever i'm doing
*   LOW LOW LOW LOW priority:small web thingie to allow user to select novel straight from website
*   auto open folder?
*/

// get chapter link, all it does
async function askQuestion(query) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(query);
    rl.close();
    return answer.trim();
}

// pause so i don't get IP banned
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. Get the list of chapters and the Novel's overall Title
async function getNovelMetadata(page, fictionUrl) {
    console.log(`\nFetching metadata from: ${fictionUrl}`);
    await page.goto(fictionUrl, { waitUntil: 'domcontentloaded' });

    const html = await page.content();
    const $ = cheerio.load(html);

    // Grab the main Novel title from the landing page
    const novelTitle = $('.fic-header h1').text().trim() || `Novel_${Date.now()}`;
    const chapters = [];

    $('#chapters tbody tr').each((index, element) => {
        const linkEl = $(element).find('td:first-child a');
        const relativeUrl = $(element).attr('data-url') || linkEl.attr('href');
        const chapterTitle = linkEl.text().trim();

        if (relativeUrl && chapterTitle) {
            chapters.push({
                index: index + 1,
                title: chapterTitle,
                url: `https://www.royalroad.com${relativeUrl}`
            });
        }
    });

    return { novelTitle, chapters };
}

// Convert text to a PDF inside a named folder
function stringToPDF(text, title, index, outputFolder, padLength) {    
    const sanitizedText = text
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u2014]/g, "--")
        .replace(/[\u2022]/g, "*");

    // Sanitizes the filename
    const paddedIndex = String(index).padStart(padLength, '0')
    let cleanFileName = title
        .replace(/[\n\r]+/g, '')
        .replace(/[/\\?%*:|"<>\s]+/g, ' ')
        .trim() + ".pdf";
    cleanFileName = `${paddedIndex}_${cleanFileName}`;
    // Set the output path to save inside our new novel folder
    const targetFilePath = path.join(outputFolder, cleanFileName);
    
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(targetFilePath);
    doc.pipe(writeStream);

    // Document Header inside the PDF
    doc.fillColor('#2c3e50')
       .fontSize(20)
       .text(title, { align: 'center' });
    
    doc.moveDown(0.5);
    
    doc.strokeColor('#bdc3c7')
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(562, doc.y)
       .stroke();
    
    doc.moveDown(1.5);

    // Write story content
    doc.fillColor('#333333')
       .fontSize(11)
       .lineGap(5)
       .text(sanitizedText, {
           align: 'left',
           paragraphGap: 12
       });

    doc.end();

    writeStream.on('finish', () => {
        console.log(`Saved: ${cleanFileName}`);
    });
}

// 3. Main Runner Process
async function run() {
    const fictionUrl = await askQuestion('Enter Royal Road Fiction URL: ');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    try {
        const page = await context.newPage();
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2}', route => route.abort());
        // Grab Title and Link Index
        const { novelTitle, chapters } = await getNovelMetadata(page, fictionUrl);
        console.log(`\nNovel Title: "${novelTitle}"`);
        console.log(`Found ${chapters.length} total chapters!`);

        if (chapters.length === 0) {
            console.log("No chapters found.");
            await browser.close();
            return;
        }

        // Clean up folder name and build absolute folder path next to the JS file
        const safeFolderName = novelTitle.replace(/[/\\?%*:|"<>\s]+/g, ' ').trim();
        const novelFolderPath = path.join(__dirname, safeFolderName);

        // Create the folder recursive (safely does nothing if folder already exists)
        if (!fs.existsSync(novelFolderPath)) {
            fs.mkdirSync(novelFolderPath, { recursive: true });
            console.log(`📁 Created novel directory at:\n ${novelFolderPath}`);
        }

        // Limit to a test batch (e.g., first 3 chapters) or remove '.slice' to pull all
        const targetChapters = chapters.slice(0, chapters.length);

        // Sequential scrape with randomized timeouts
        for (const chapter of targetChapters) {
            console.log(`---------------------------------`);
            console.log(`[${chapter.index}/${targetChapters.length}] Scraping: ${chapter.title}`);
            
            await page.goto(chapter.url, { waitUntil: 'domcontentloaded' });
            
            const html = await page.content();
            const $ = cheerio.load(html);
            
            let text = "";
            $('.chapter-inner.chapter-content p').each((_, element) => {
                text += $(element).text().trim() + "\n\n";
            });
            
            // for good looking title
            const padLength = String(targetChapters.length).length;
            // Convert and save this chapter inside our novel folder
            stringToPDF(text, chapter.title, chapter.index, novelFolderPath, padLength);

            // 'please don't IP ban me' delay
            //console.log("TEST");
            const delay = Math.floor(Math.random() * 1000);
            console.log(`Sleeping for ${(delay / 1000).toFixed(1)}s`);
            await sleep(delay);
        }

        console.log(`\nCheck your new folder:\n📁 ${novelFolderPath}`);

    } catch (err) {
        console.error('Fatal execution error:', err);
    } finally {
        await browser.close();
    }
}

run();
