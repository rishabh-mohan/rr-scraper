const { safeName } = require('./helpers');

function planFiles(chapters, perFile, novelTitle) {
    if (!Number.isSafeInteger(perFile) || perFile < 1) throw new Error('Invalid chapter group size');
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


module.exports = { planFiles };
