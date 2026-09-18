# FB Marketplace Smart Search

A Chrome extension (Manifest V3) that tightens Facebook Marketplace search.

Facebook still runs the search. This extension then keeps a listing only when **every word you typed** appears in that item's title or description, in any order. Matching words are highlighted. Ads and "results from outside your search" are hidden. Remaining tiles pack into a normal grid with no empty holes.

Search `honda cbr 150` and a Honda CBR without `150`, a CBR 150 without Honda, or a CBR 250 will drop out.

![Packed Marketplace results after an exact-word filter](docs/demo.png)

## Features

- **All-word match**: every token must appear in the title, the description, or split across both
- **Order does not matter**: `cbr honda 150` matches the same listings as `honda cbr 150`
- **Whole words only**: `150` does not match `1500`, and `cbr` does not match a longer token that only contains those letters
- **Highlights** matching words on kept cards
- **Hides ads** and the outside-your-search block
- **Packs the grid** so leftover results look like a normal feed
- **On-page bar** with search, match counts, and an on/off toggle

## Install (unpacked)

1. Clone this repo and install dependencies:

```bash
git clone https://github.com/torrefrancae/chrome-extension-fb-smart-search.git
cd chrome-extension-fb-smart-search
npm install
npm run build
```

2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `dist` folder (not the repo root).
5. Open [Facebook Marketplace](https://www.facebook.com/marketplace/) and search as usual.

Reload the extension on `chrome://extensions` after each `npm run build`.

## How it works

1. Facebook performs its own Marketplace search.
2. A page-world script reads listing payloads from Marketplace network responses.
3. An isolated content script scores each result card: every query word must appear in the title or description.
4. Non-matching tiles, ads, and the outside-search block are hidden at the grid-cell level so the row closes up.
5. Kept cards get yellow highlights on the matched words.

The extension does not call a private API of its own. It only filters the Marketplace page you already opened.

## Project layout

```text
src/
  background.ts          Service worker: injects on Marketplace navigations
  content/               Overlay, card detection, ads, highlights
  shared/                Tokenizer, match rules, listing extraction
  popup/                 Toolbar popup
scripts/build.ts         Bundles TypeScript into dist/
tests/match.test.ts      Unit tests for the matcher
tests/listing.test.ts    Unit tests for payload parsing
tests/puppeteer/         Optional live Chrome tests
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle the extension into `dist/` |
| `npm test` | Run matcher and listing unit tests |
| `npm run test:browser` | Puppeteer fixture plus a fresh-profile Marketplace check |
| `npm run test:browser -- --screenshots --html-report` | Same, with a local HTML report |

Live session tests attach to a Chrome instance you start yourself. They are optional and are not required to build or load the extension.

```bash
./scripts/launch-session.sh
npm run test:session -- --query="honda cbr 150" --screenshots --html-report
```

## Tests

```bash
npm test
```

The matcher tests cover:

- words in any order
- words split across title and description
- title-only and description-only hits
- a missing word (listing is dropped)
- whole-word boundaries (`civic` vs `civics`)

## Privacy

- Runs locally in your browser
- Stores only an on/off flag in `chrome.storage.local`
- Does not send listing data to a third-party server

## License

MIT
