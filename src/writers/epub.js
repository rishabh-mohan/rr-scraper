const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');

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


module.exports = writeEPUB;
