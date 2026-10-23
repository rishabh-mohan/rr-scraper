const { ask } = require('./helpers');
const { FORMATS } = require('./writers');

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
        if (/^\d+$/.test(answer) && Number.isSafeInteger(Number(answer)) && Number(answer) > 0) return Math.min(parseInt(answer, 10), total);
        console.log('  Enter a positive number, or "all".');
    }
}


module.exports = { askFormat, askChaptersPerFile };
