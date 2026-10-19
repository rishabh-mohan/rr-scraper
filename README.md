# rr-scraper

An interactive command-line tool for downloading Royal Road fiction chapters as
**TXT, PDF, or EPUB** files. Search by title or paste a fiction URL, choose an output
format, and save chapters individually, in groups, or as one book.

The scraper uses Playwright's headless Chromium browser to load pages, Cheerio to
parse fiction metadata, PDFKit to generate PDFs, and JSZip to build EPUBs.

## Features

- Search Royal Road and choose from up to five results, including chapter counts
  and ratings when available.
- Open a fiction directly using its URL.
- Export UTF-8 text, PDFs with chapter bookmarks, or EPUB 3 files with a table of contents.
- Choose how many chapters to include in each file.
- Skip files that already exist when rerunning with the same export settings.
- Retry failed chapter requests up to three attempts.
- Write through temporary `.part` files before renaming completed exports.
- Attempt to open the output folder when finished.

## Requirements

- A recent [Node.js LTS release](https://nodejs.org/en/download) and npm.
- Git, if cloning the repository.
- An internet connection and the Playwright Chromium browser installation.
- An interactive terminal: configuration is entered through prompts.

The repository currently contains `chapter-scraper.js` without a `package.json` or
lockfile. Install its dependencies manually using the commands below. Dependency
versions are not pinned by the upstream repository.

## Installation

```sh
git clone https://github.com/rishabh-mohan/rr-scraper.git
cd rr-scraper
npm init -y
npm install cheerio playwright pdfkit jszip
npx playwright install chromium
```

On Linux, if Chromium reports missing system libraries, use Playwright's dependency
installer:

```sh
npx playwright install --with-deps chromium
```

## Usage

```sh
node chapter-scraper.js
```

The program asks for:

1. **A fiction URL or search title.** Paste a Royal Road fiction page URL, or type
   a title to search. Use the fiction's main page, rather than an individual chapter.
2. **A search result**, if searching by title. Press Enter to select the first result.
   An invalid or out-of-range selection also falls back to the first result.
3. **An output format.** Enter a number or format name:

   | Input | Format |
   |---|---|
   | `1` or `txt` | Plain text |
   | `2` or `pdf` | PDF — default |
   | `3` or `epub` | EPUB |

4. **Chapters per file.** Enter a positive integer, or press Enter to put all chapters
   in one file. `all` and `0` also mean all chapters.

For example, choosing `epub` and `10` produces files containing up to ten chapters
each. Choosing `1` chapter per file saves each chapter separately.

There are no command-line flags for the URL, format, or chapter grouping; these
settings are selected interactively.

## Output

Exports are saved in a sanitized novel-title folder **beside `chapter-scraper.js`**.
Invalid filename characters are removed, and title-derived filename components are
limited to 120 characters.

For a fictional 25-chapter book named `Example Novel`:

```text
rr-scraper/
├── chapter-scraper.js
└── Example Novel/
    ├── Example Novel (01-10).epub
    ├── Example Novel (11-20).epub
    └── Example Novel (21-25).epub
```

Other grouping choices produce different names:

| Grouping | Example filename |
|---|---|
| All chapters | `Example Novel.pdf` |
| One chapter per file | `01_Chapter One.txt` |
| Multiple chapters per file | `Example Novel (01-10).epub` |

Chapter numbering follows the order of rows in the fiction page's chapter table.
Padding width depends on the total number of chapters found.

## Rerunning and failed downloads

Existing output files are skipped by filename. To retry missing files, rerun the
program and choose the same fiction, format, and chapter grouping.

If a chapter request still fails after three attempts, its entire output group is
left unwritten and processing continues with later groups. File-writing failures
are also reported in the final failure list.

This is **file-level skipping**, not an incremental update system. Existing files
are not checked for completeness or refreshed when the author edits or adds chapters.
In particular, an existing all-chapters export will be skipped even if new chapters
have since appeared. Move or rename the old export to create a fresh one.

If a chapter loads successfully but contains no matching paragraphs, the script warns
and leaves that chapter out; the rest of its group may still be saved. Review warnings
as well as the final failure list.

## Debugging

Set `DEBUG=1` to save the HTML used for search and fiction-page parsing.

**PowerShell:**

```powershell
$env:DEBUG = '1'
node chapter-scraper.js
```

**macOS / Linux:**

```sh
DEBUG=1 node chapter-scraper.js
```

Debug files are written to the current working directory:

- `debug_search.html` — when searching by title.
- `debug_fiction.html` — when loading the selected fiction.

If a page returns no results or chapters, inspect these files for a changed page
layout, an access challenge, or an unexpected URL. The script does not implement
login or interactive challenge handling.

## How it works

1. Starts a headless Chromium browser and blocks image and font requests.
2. Searches for a title, or opens the supplied fiction URL.
3. Reads the novel title, author, and chapter links from the fiction page.
4. Plans output groups and skips existing files.
5. Visits chapters sequentially and collects nonempty paragraphs from the chapter
   content container, excluding paragraphs whose computed display or visibility is hidden.
6. Writes each group in the chosen format, then attempts to open the output folder.

Chapter requests are separated by a randomized delay of approximately 300–1,000 ms.
Failed requests use a one-second delay before the second attempt and a two-second
delay before the third.

## Limitations

- Different novels with the same sanitized title share an output folder and can
  collide. Novel IDs are not included in folder names.
- Only paragraph text is exported. Images, original styling, tables, and other
  non-paragraph content are not preserved as such.
- Parsing depends on Royal Road's current HTML structure and selectors.
- There is no chapter-range selector, scheduled update mode, or authenticated session support.
- All chapters for an output group are held in memory before the file is written;
  large all-in-one exports require more memory and must restart their group after failure.
- PDF output normalizes several punctuation characters and uses PDFKit's default font.
  Characters outside that font's coverage may not render correctly.
- EPUB metadata declares English as the book language.

## Dependencies

| Package | Purpose |
|---|---|
| `playwright` | Browser navigation and rendered paragraph extraction |
| `cheerio` | Search-result and fiction-metadata parsing |
| `pdfkit` | PDF generation and chapter bookmarks |
| `jszip` | EPUB packaging |

Other imports are built into Node.js. The script selects the platform's folder
opener: Explorer on Windows, `open` on macOS, or `xdg-open` on Linux.

## License

The upstream repository does not currently include a license file.

## Source

[rishabh-mohan/rr-scraper](https://github.com/rishabh-mohan/rr-scraper), documented
from [`chapter-scraper.js`](https://github.com/rishabh-mohan/rr-scraper/blob/main/chapter-scraper.js).
