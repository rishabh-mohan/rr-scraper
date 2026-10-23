const fs = require('node:fs');

async function writeTXT(chapters, meta, filePath) {
    // Plain UTF-8: curly quotes etc. are fine in text files, so no sanitizing.
    const parts = chapters.map((ch) => {
        const underline = '='.repeat(Math.min(ch.title.length, 80));
        return `${ch.title}\n${underline}\n\n${ch.paragraphs.join('\n\n')}`;
    });
    await fs.promises.writeFile(filePath, parts.join('\n\n\n') + '\n', 'utf8');
}


module.exports = writeTXT;
