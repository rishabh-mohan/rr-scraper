const fs = require('node:fs');
const writeTXT = require('./txt');
const writePDF = require('./pdf');
const writeEPUB = require('./epub');

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


module.exports = { FORMATS, writeAtomic };
