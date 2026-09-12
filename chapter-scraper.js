const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const fs = require('fs');

/* TODO   
*   Implement search feature to find best match novels
*   Find way to use just novel page (ex. https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/)
*       to scrape entire book, store as txt
*   Find way to store as pdf/epub?
*   LOW LOW PRIORITY: Implement website/similar to view novels
* 
*/

function askQuestion() {
    return new Promise((resolve) => {
        process.stdout.write('Insert Link here: ');
        process.stdin.resume();
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}

async function run() {
    const URL = await askQuestion();
    //console.log(URL);

    try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        console.log("Navigating");
        await page.goto(URL, { waitUntil: 'domcontentloaded' });

        const response = await page.content();
        const $ = cheerio.load(response);
        console.log("Scraped");
        await browser.close();
        let text = "";
        //chapter-inner chapter-content
                $('.chapter-inner.chapter-content p').each((_, element) => {
            text += $(element).text() + "\n\n";
        });


        //console.log(text);
        fs.writeFile('output.txt', text, 'utf8', (err) => {
            if (err) {
                console.error('Error saving the file:', err);
            } else {
                console.log('File successfully saved!');
            }
        });
        
    } catch (err) {
        console.error(err);
    }
}

run();
