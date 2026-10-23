async function createContext(browser) {
    // Use the installed browser's current identity rather than a hardcoded version.
    const probe = await browser.newPage();
    let userAgent;
    try {
        userAgent = await probe.evaluate(() => navigator.userAgent);
    } finally {
        await probe.close();
    }
    return browser.newContext({ userAgent: userAgent.replace('HeadlessChrome/', 'Chrome/') });
}

module.exports = { createContext };
