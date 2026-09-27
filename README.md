# Facebook AI Agent 2.0

Chrome extension (Manifest V3) for Marketplace search and inbox chat hunting from a dedicated agent page.

You search on the agent page. The extension opens Facebook Marketplace in a background tab to collect listings, then lists only the matches on the agent page. Facebook's own search screen is left alone. Opening an item opens the normal Marketplace item page, with no filter panel.

The older reply-only agent lives under `../archive/fb-ai-agent-v1-chrome-extension`.

Search `honda cbr 150` and a Honda CBR without `150`, a CBR 150 without Honda, or a CBR 250 will drop out. With Contains on, `ninja 250` also keeps `ninja z250sl`. A size like `48gb` also matches `48 GB`. Prices like `PHP250,000` do not count as a `250` match. Don't include words such as `parts, wrecked` hide those listings.

![Packed Marketplace results after filtering](docs/demo.png)

## Features

- **Separate agent page**: the toolbar icon opens Facebook AI Agent, not Facebook
- **Buying and Selling chats**: search your Marketplace inbox chats by item or person
- **All-word match**: every token must appear in the title, the description, or split across both
- **Don't include**: comma-separated words hide a listing if any of those words match (`parts, wrecked`)
- **Openable results only**: empty teasers and dead item ids are dropped
- **Detail modal**: clicks stay on the agent page; Marketplace descriptions load only when you open a row
- **Order does not matter**: `cbr honda 150` matches the same listings as `honda cbr 150`
- **Contains or whole word**: Contains is on by default, so `ninja 250` keeps `ninja z250sl`
- **Prices ignored**: `PHP250,000` does not satisfy a `250` token
- **Memory sizes**: `48gb` matches `48GB` and `48 GB`, but not a 48-core GPU with 16GB RAM
- **Highlights** matching words on kept cards
- **Item view stays clean**: clicking a result opens the Marketplace item with no agent panel

## Install (unpacked)

1. Clone this repo and install dependencies:

```bash
git clone https://github.com/torrefrancae/fb-ai-agent-chrome-extension.git
cd fb-ai-agent-chrome-extension
npm install
npm run build
```

2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `dist` folder (not the repo root).
5. Click the extension icon to open Facebook AI Agent.

Reload the extension on `chrome://extensions` after each `npm run build`.

## How it works

1. You type a search on the agent page, pick Marketplace, Buying chats, or Selling chats, plus optional Don't include words.
2. The extension opens Marketplace search or the Buying/Selling inbox in a background tab.
3. A page-world script reads listing or chat payloads from Marketplace network responses and visible cards.
4. Matching results are drawn on the agent page. Facebook's own grid is not hidden or rewritten.
5. Don't include drops a result if any comma-separated word matches.
6. Click a row to open details in a modal on the agent page. Marketplace item text is fetched only then. Buying and Selling chats stay in the modal too.

If Facebook asks you to log in, use **Harvest** to show the background Marketplace tab, then come back to the agent page.

## Project layout

```text
src/
  background.ts          Service worker: search page, harvest tab, listing relay
  search/                Standalone search page
  content/               Marketplace collector (no on-page filter UI)
  shared/                Tokenizer, match rules, listing extraction
  popup/                 Optional launcher
scripts/build.ts         Bundles TypeScript into dist/
tests/match.test.ts      Unit tests for the matcher
tests/results.test.ts    Unit tests for the search-page result list
tests/listing.test.ts    Unit tests for payload parsing
tests/float.test.ts      Unit tests for panel edge snap
tests/puppeteer/         Optional live Chrome tests
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle the extension into `dist/` |
| `npm test` | Run matcher, listing, and search-page unit tests |
| `npm run test:browser` | Puppeteer fixture plus Marketplace checks (headless) |
| `npm run test:browser -- --screenshots --html-report` | Same, with a local HTML report under `.idea/report/` |
| `npm run test:browser:headed` | Headed browser run that reuses the saved Facebook login |
| `./scripts/launch-session.sh` | Open Chrome with the persistent Facebook profile so you can log in |

### Persistent Facebook login for browser tests

Live Marketplace checks need a logged-in Facebook session. That profile is stored locally at:

```text
.idea/chrome-session/
```

It is gitignored. Sign in once into **this** profile (not your everyday Chrome). Tests look for the Facebook `c_user` cookie before treating the session as logged in.

**First-time login (pick one):**

```bash
# Option A: open the persistent profile and log in manually
npm run build
./scripts/launch-session.sh
# Log in to Facebook Marketplace in the window that opens.
# Quit that Chrome fully when Marketplace shows you signed in (cookies flush on quit).

# Option B: let the headed test open Chrome and wait for you
npm run build
npm run test:browser:headed
# When the console says to log in, finish Facebook login in the opened window.
# Wait until Marketplace is signed in; the runner requires the c_user cookie.
```

**Later runs (already logged in):**

Only one Chrome can use `.idea/chrome-session` at a time. Quit `launch-session` first if it is still open, then:

```bash
npm run build
npm run test:browser -- --screenshots --html-report
# or keep watching the browser:
npm run test:browser:headed
```

Optional attach-style session probe (uses the same profile via debugging port 9333):

```bash
./scripts/launch-session.sh
npm run test:session -- --query="honda cbr 150" --screenshots --html-report
```

HTML reports land in `.idea/report/` (also gitignored). Open `smart-search-browser-test.html` after a screenshot run.
## Tests

```bash
npm test
```

The matcher tests cover:

- words in any order
- words split across title and description
- title-only and description-only hits
- a missing word (listing is dropped)
- comma-separated Don't include words that hide a listing
- substring hits such as `ninja 250` inside `ninja z250sl`
- exact mode so `civic` does not match `civics`
- prices so `PHP250,000` is not treated as a `250` model match

## Privacy

- Runs locally in your browser
- Stores substring vs exact, Don't include words, and the last search in `chrome.storage.local`
- Does not send listing data to a third-party server

## License

MIT
