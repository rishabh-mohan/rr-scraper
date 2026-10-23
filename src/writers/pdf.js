const fs = require('node:fs');
const PDFDocument = require('pdfkit');

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


module.exports = writePDF;
