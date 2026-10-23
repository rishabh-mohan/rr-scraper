# rr-scraper

Download Royal Road fiction as TXT, PDF, or EPUB from an interactive terminal.

## Quick start

On **Windows or macOS**, install **Node.js 22 or newer** (including npm), download and extract this repository, open a terminal in its folder, and run:

```sh
node chapter-scraper.js
```

On first run, the launcher automatically installs the pinned npm dependencies and downloads Playwright Chromium. Later runs reuse them. Internet access and a writable repository folder are required; you do not need Git, Python, or a separately installed browser. Setup may take a few minutes.

You can also use `npm start`. To install without entering the interactive prompts, use `node chapter-scraper.js --setup`. Run `node chapter-scraper.js --help` for help.

Chromium runs in the background without opening a visible window. If Royal Road requires a manual access check, the scraper reports it without opening a window. For troubleshooting, you can explicitly run `node chapter-scraper.js --show-browser`, complete the check in that window, and let downloading continue.

## Usage

1. Paste a Royal Road fiction URL (the book's main page) or enter a search title.
2. Choose a search result if prompted.
3. Choose TXT, PDF (default), or EPUB.
4. Enter chapters per file, or press Enter for all chapters in one file.

Files go into `downloads/Title (fiction ID)/` inside the repository. The ID prevents different books with the same title from sharing a folder. The program attempts to open that folder when finished.

Existing files are skipped by filename. Rerun with the same format and grouping to retry failures. Chapter failures, including empty content, retry three times; a failed group is left unwritten so it can be retried. Writes use temporary `.part` files. Failed exports produce a nonzero exit status.

Existing exports are not refreshed when chapters are added or edited. Move or delete an older export to regenerate it. Only visible paragraph text is exported; images, tables, and original styling are not preserved. PDF uses the built-in font, which has limited Unicode coverage. EPUB declares English. Login sessions are not saved between runs. Access checks require manual completion in the browser.

Set `DEBUG=1` to save search and fiction HTML to the current directory. In PowerShell: `$env:DEBUG = '1'`. If Royal Road changes its layout or blocks access, these files can help diagnose parsing failures.

## Development

Run `npm ci` and `npm test`. Tests use local fixtures and do not contact Royal Road. After first-run setup, run `npm run test:browser` to verify Chromium and hidden-paragraph filtering.

- `chapter-scraper.js`: Node-only launcher and first-run setup.
- `src/app.js`: download orchestration.
- `src/royal-road.js`: search, metadata, and visible chapter extraction.
- `src/prompts.js` and `src/planning.js`: interactive settings and export grouping.
- `src/writers/`: TXT, PDF, EPUB, and atomic writes.
- `src/helpers.js`: filenames, retries, and platform helpers.

Dependencies are pinned in `package-lock.json`. If installation fails, check the network connection and rerun the launcher. Delete `node_modules` to force a clean install.

Based on [rishabh-mohan/rr-scraper](https://github.com/rishabh-mohan/rr-scraper). The upstream source did not include a license file.
