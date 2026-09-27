import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

type Shot = { name: string; title: string; png: Buffer };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const reportDir = join(root, ".idea", "report");
const isolatedUserData = join(root, ".idea", "chrome-user-data");
const sessionUserData = join(root, ".idea", "chrome-session");
const sessionReadyMarker = join(root, ".idea", "chrome-session.ready");
const facebookCookieJar = join(root, ".idea", "facebook-cookies.json");
const sessionDebugPort = 9333;
const betaUserData = join(root, ".idea", "chrome-beta-clone");
const chromeCandidates = [
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];

function resolveChrome(): string {
  for (const candidate of chromeCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome or Chrome Beta not found");
}

const chromePath = resolveChrome();

const flags = new Set(process.argv.slice(2));
const wantShots = flags.has("--screenshots");
const wantReport = flags.has("--html-report");
const useBetaProfile = flags.has("--beta-profile");
const headed = flags.has("--headed") || flags.has("--headful");
const shots: Shot[] = [];

function isLoginWall(url: string): boolean {
  return /login|checkpoint|two_factor/i.test(url);
}

async function hasFacebookAuth(page: Page): Promise<boolean> {
  const cookies = await page.cookies("https://www.facebook.com", "https://www.facebook.com/");
  return cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value));
}

async function saveFacebookCookies(page: Page): Promise<void> {
  const cookies = await page.cookies("https://www.facebook.com", "https://www.facebook.com/");
  if (!cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value))) {
    return;
  }
  writeFileSync(facebookCookieJar, JSON.stringify(cookies, null, 2));
  writeFileSync(sessionReadyMarker, `${new Date().toISOString()}\n`);
  console.log(`facebook-cookies=saved count=${cookies.length}`);
}

async function restoreFacebookCookies(page: Page): Promise<boolean> {
  if (!existsSync(facebookCookieJar)) {
    return false;
  }
  try {
    const cookies = JSON.parse(readFileSync(facebookCookieJar, "utf8")) as Parameters<
      Page["setCookie"]
    >[0][];
    if (!cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value))) {
      return false;
    }
    await page.setCookie(...cookies);
    console.log(`facebook-cookies=restored count=${cookies.length}`);
    return true;
  } catch (error) {
    console.log(`facebook-cookies=restore-failed ${(error as Error).message}`);
    return false;
  }
}

function clearSessionLocks(): void {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const target = join(sessionUserData, name);
    if (existsSync(target)) {
      try {
        unlinkSync(target);
      } catch {
        /* still held */
      }
    }
  }
}

async function waitForProfileIdle(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      execSync(`pgrep -f "user-data-dir=${sessionUserData}"`, { stdio: "ignore" });
    } catch {
      clearSessionLocks();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  clearSessionLocks();
}

async function launch(options?: {
  userDataDir?: string;
  headless?: boolean;
  profile?: string;
}): Promise<Browser> {
  const dataDir = options?.userDataDir || isolatedUserData;
  mkdirSync(dataDir, { recursive: true });
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled"
  ];
  if (options?.profile) {
    args.push(`--profile-directory=${options.profile}`);
  }
  return puppeteer.launch({
    executablePath: chromePath,
    headless: options?.headless ?? !headed,
    pipe: true,
    enableExtensions: [dist],
    userDataDir: dataDir,
    defaultViewport: headed ? null : { width: 1400, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args
  });
}

async function debugPortOpen(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${sessionDebugPort}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function closeDebugSession(): Promise<void> {
  if (!(await debugPortOpen())) {
    await waitForProfileIdle();
    return;
  }
  console.log(`session-release=port:${sessionDebugPort}`);
  try {
    const version = (await fetch(`http://127.0.0.1:${sessionDebugPort}/json/version`).then((res) =>
      res.json()
    )) as { webSocketDebuggerUrl: string };
    const browser = await puppeteer.connect({
      browserWSEndpoint: version.webSocketDebuggerUrl,
      defaultViewport: null
    });
    const pages = await browser.pages();
    if (pages[0]) {
      await saveFacebookCookies(pages[0]);
    }
    await browser.close();
  } catch (error) {
    console.log(`session-release=soft-fail ${(error as Error).message}`);
  }
  await waitForProfileIdle();
}

let sharedLiveBrowser: Browser | null = null;

async function launchSessionBrowser(): Promise<Browser> {
  if (sharedLiveBrowser) {
    try {
      sharedLiveBrowser.targets();
      console.log("session-reuse=shared-live-browser");
      return sharedLiveBrowser;
    } catch {
      sharedLiveBrowser = null;
    }
  }
  mkdirSync(sessionUserData, { recursive: true });
  console.log(`session-profile=${sessionUserData}`);
  await closeDebugSession();
  console.log("session-launch=chrome-session+extension");
  sharedLiveBrowser = await launch({
    userDataDir: sessionUserData,
    headless: !headed
  });
  return sharedLiveBrowser;
}

async function waitForFacebookLogin(page: Page): Promise<boolean> {
  await restoreFacebookCookies(page);
  await page.goto("https://www.facebook.com/marketplace/", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  }).catch(() => undefined);
  if ((await hasFacebookAuth(page)) && !isLoginWall(page.url())) {
    await saveFacebookCookies(page);
    console.log("facebook-login=ok (reuse)");
    return true;
  }
  if (!headed) {
    console.log(
      "facebook-login-required: no saved Facebook cookies. Run ./scripts/launch-session.sh, finish Marketplace login, quit that Chrome, then re-run."
    );
    return false;
  }
  console.log("Log in to Facebook in THIS Chrome window only.");
  console.log(`Profile: ${sessionUserData}`);
  console.log("Wait until Marketplace shows while signed in. Up to 5 minutes...");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!(await hasFacebookAuth(page))) {
      continue;
    }
    await page.goto("https://www.facebook.com/marketplace/", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    }).catch(() => undefined);
    if ((await hasFacebookAuth(page)) && !isLoginWall(page.url())) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await saveFacebookCookies(page);
      console.log("facebook-login=ok");
      return true;
    }
  }
  console.log("facebook-login=timeout (still no c_user)");
  return false;
}

async function closeBrowser(browser: Browser): Promise<void> {
  if (browser === sharedLiveBrowser) {
    return;
  }
  const proc = browser.process();
  if (!proc) {
    browser.disconnect();
    return;
  }
  await browser.close().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function closeSharedLiveBrowser(): Promise<void> {
  const browser = sharedLiveBrowser;
  sharedLiveBrowser = null;
  if (!browser) {
    return;
  }
  try {
    const pages = await browser.pages();
    if (pages[0]) {
      await saveFacebookCookies(pages[0]);
    }
  } catch {
    /* browser already closing */
  }
  const proc = browser.process();
  await browser.close().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (proc && !proc.killed) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }
  await waitForProfileIdle();
}

async function snap(page: Page, name: string, title: string): Promise<void> {
  if (!wantShots && !wantReport) {
    return;
  }
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 5000 }).catch(() => undefined);
  shots.push({
    name,
    title,
    png: Buffer.from(await page.screenshot({ fullPage: true, type: "png" }))
  });
}

function writeReport(): string {
  mkdirSync(reportDir, { recursive: true });
  const figures = shots
    .map((shot, index) => {
      const n = index + 1;
      return `<figure><figcaption>Figure ${n}.0 ${shot.title}</figcaption><img alt="${shot.title}" src="data:image/png;base64,${shot.png.toString("base64")}" /></figure>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Facebook AI Agent browser test report</title>
    <style>
      body { font-family: Helvetica, Arial, sans-serif; margin: 24px; color: #111; background: #fff; }
      h1 { margin: 0 0 8px; }
      p { color: #444; }
      figure { margin: 24px 0; }
      figcaption { margin: 0 0 8px; font-weight: 700; }
      img { max-width: 100%; border: 1px solid #ccc; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <h1>Facebook AI Agent browser test report</h1>
    <p>Fixture and live browser steps with screenshots captured after the UI settled.</p>
    ${figures || "<p>No screenshots were captured.</p>"}
  </body>
</html>`;
  const file = join(reportDir, "smart-search-browser-test.html");
  writeFileSync(file, html);
  return file;
}

async function runFixture(): Promise<void> {
  const browser = await launch({
    userDataDir: isolatedUserData,
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const url = pathToFileURL(join(dist, "search", "search.html")).href;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#query");
    await page.click("#match-regex", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click("#price-ranges", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click("#exclude", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.evaluate((listings) => {
      window.postMessage(
        {
          source: "fbx-search",
          type: "snapshot",
          query: "civic 2015",
          href: "https://www.facebook.com",
          mode: "marketplace",
          listings
        },
        "*"
      );
    }, [
      {
        id: "111111111111",
        numericId: "111111111111",
        title: "Honda Civic 2015",
        description: "One owner, garage kept",
        price: "PHP 280,000",
        photo: "https://example.com/civic.jpg",
        photos: ["https://example.com/civic.jpg", "https://example.com/civic-2.jpg"],
        href: "https://www.facebook.com/marketplace/item/111111111111/",
        kind: "listing",
        party: ""
      },
      {
        id: "222222222222",
        numericId: "222222222222",
        title: "Toyota Vios 2018",
        description: "Honda mats included",
        price: "PHP 90,000",
        photo: "https://example.com/vios.jpg",
        photos: ["https://example.com/vios.jpg"],
        href: "https://www.facebook.com/marketplace/item/222222222222/",
        kind: "listing",
        party: ""
      },
      {
        id: "333333333333",
        numericId: "333333333333",
        title: "Civic Hatchback",
        description: "2015 model year, clean papers",
        price: "PHP 310,000",
        photo: "https://example.com/hatch.jpg",
        photos: ["https://example.com/hatch.jpg"],
        href: "https://www.facebook.com/marketplace/item/333333333333/",
        kind: "listing",
        party: ""
      },
      {
        id: "ghost",
        numericId: "",
        title: "Fake teaser",
        description: "civic 2015",
        price: "",
        photo: "",
        photos: [],
        href: "",
        kind: "listing",
        party: ""
      }
    ]);

    await page.waitForFunction(() => document.querySelectorAll("[data-listing-id]").length === 2);
    await page.waitForFunction(() => Boolean(document.querySelector(".brand-row h1")));
    await page.waitForFunction(() => {
      const market = document.querySelector('.tab[data-mode="marketplace"]');
      const bar = document.querySelector("#status-bar");
      return Boolean(
        market &&
          /Market list/i.test(market.textContent || "") &&
          market.getAttribute("aria-selected") === "true" &&
          bar
      );
    });
    await snap(page, "fixture-results", "Top tab bar with matching Market list rows");

    const exclude = await page.waitForSelector("#exclude");
    await exclude.click({ clickCount: 3 });
    await exclude.type("hatchback, wrecked");
    await page.waitForFunction(() => {
      const ids = [...document.querySelectorAll("[data-listing-id]")].map((node) =>
        (node as HTMLElement).dataset.listingId
      );
      return ids.length === 1 && ids[0] === "111111111111";
    });
    await snap(page, "fixture-filtered", "Don't include filter left one Civic row");

    await page.click("[data-listing-id='111111111111']");
    await page.waitForSelector(".modal-backdrop:not([hidden])");
    await page.waitForFunction(() => {
      const note = document.querySelector(".modal-info .note");
      const external = document.querySelector(".modal-info .open-external");
      return (
        Boolean(note && (note.textContent || "").includes("One owner")) &&
        Boolean(external && (external as HTMLAnchorElement).href.includes("/marketplace/item/111111111111"))
      );
    });
    await snap(page, "fixture-modal", "Detail modal opens without leaving Facebook AI Agent");
    await page.click(".modal-close");
    await page.waitForSelector(".modal-backdrop[hidden]");

    await page.evaluate((listings) => {
      window.postMessage(
        {
          source: "fbx-search",
          type: "snapshot",
          query: "macbook 16gb",
          href: "https://www.facebook.com",
          mode: "marketplace",
          listings
        },
        "*"
      );
    }, [
      {
        id: "700001",
        numericId: "700001",
        title: "MacBook Pro M1 16GB",
        description: "Apple silicon",
        price: "PHP 40,000",
        photo: "https://example.com/m1.jpg",
        photos: ["https://example.com/m1.jpg"],
        href: "https://www.facebook.com/marketplace/item/700001/",
        kind: "listing",
        party: ""
      },
      {
        id: "700002",
        numericId: "700002",
        title: "MacBook Pro Intel 16GB",
        description: "older chip",
        price: "PHP 25,000",
        photo: "https://example.com/intel.jpg",
        photos: ["https://example.com/intel.jpg"],
        href: "https://www.facebook.com/marketplace/item/700002/",
        kind: "listing",
        party: ""
      },
      {
        id: "700003",
        numericId: "700003",
        title: "MacBook Air 16GB",
        description: "M2 chip, light",
        price: "PHP 35,000",
        photo: "https://example.com/m2.jpg",
        photos: ["https://example.com/m2.jpg"],
        href: "https://www.facebook.com/marketplace/item/700003/",
        kind: "listing",
        party: ""
      }
    ]);
    await page.click("#query", { clickCount: 3 });
    await page.type("#query", "macbook 16gb");
    await page.click("#exclude", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click("#match-regex", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => {
      const ids = [...document.querySelectorAll("[data-listing-id]")].map(
        (node) => (node as HTMLElement).dataset.listingId
      );
      return ids.length === 3 && ids.includes("700001") && ids.includes("700002") && ids.includes("700003");
    });
    await page.type("#match-regex", "m(1|2)");
    await page.waitForFunction(() => {
      const ids = [...document.querySelectorAll("[data-listing-id]")].map(
        (node) => (node as HTMLElement).dataset.listingId
      );
      const advanced = document.querySelector("#advanced-bar");
      return (
        ids.length === 2 &&
        ids.includes("700001") &&
        ids.includes("700003") &&
        !ids.includes("700002") &&
        advanced?.getAttribute("data-state") === "active"
      );
    });
    await snap(page, "fixture-regex", "Advanced regex m(1|2) keeps M1 and M2 MacBooks only");

    await page.click("#match-regex", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click("#price-ranges", { clickCount: 3 });
    await page.type("#price-ranges", "30000-42000 and 5-10");
    await page.waitForFunction(() => {
      const ids = [...document.querySelectorAll("[data-listing-id]")].map(
        (node) => (node as HTMLElement).dataset.listingId
      );
      const advanced = document.querySelector("#advanced-bar");
      return (
        ids.length === 2 &&
        ids.includes("700001") &&
        ids.includes("700003") &&
        !ids.includes("700002") &&
        advanced?.getAttribute("data-state") === "active" &&
        /prices/i.test(document.querySelector("#advanced-state")?.textContent || "")
      );
    });
    await snap(page, "fixture-price-ranges", "Price ranges keep MacBooks inside selected bands");

    await page.click("#price-ranges", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click('.tab[data-mode="buying"]');
    await page.waitForFunction(() => {
      const buying = document.querySelector('.tab[data-mode="buying"]');
      const bar = document.querySelector("#status-bar");
      const panel = document.querySelector(".loading-panel");
      return (
        buying?.getAttribute("aria-selected") === "true" &&
        bar?.getAttribute("data-phase") === "running" &&
        /Searching/i.test(document.querySelector("#phase-label")?.textContent || "") &&
        Boolean(panel && /Search running/i.test(panel.textContent || ""))
      );
    });
    await snap(page, "fixture-buying-loading", "Status bar shows Searching while Buying chats load");
    await page.evaluate(() => {
      window.postMessage(
        {
          source: "fbx-search",
          type: "snapshot",
          query: "",
          mode: "buying",
          href: "https://www.facebook.com/marketplace/inbox?targetTab=BUYER",
          listings: [
            {
              id: "9001",
              numericId: "9001",
              title: "Partial chat",
              description: "hello",
              price: "",
              photo: "https://example.com/a.jpg",
              photos: ["https://example.com/a.jpg"],
              href: "https://www.facebook.com/marketplace/t/9001/",
              kind: "buying",
              party: "Seller"
            }
          ]
        },
        "*"
      );
    });
    await page.waitForFunction(() => {
      const bar = document.querySelector("#status-bar");
      const rows = document.querySelectorAll("[data-listing-id]").length;
      const message = document.querySelector("#status")?.textContent || "";
      return (
        rows > 0 &&
        bar?.getAttribute("data-phase") === "running" &&
        /Still searching/i.test(message)
      );
    });
    await snap(page, "fixture-status-running-with-results", "Status bar stays Searching after first results");
    await page.click('.tab[data-mode="marketplace"]');
    await page.waitForFunction(() => {
      const market = document.querySelector('.tab[data-mode="marketplace"]');
      return market?.getAttribute("aria-selected") === "true";
    });
    await snap(page, "fixture-back-market", "Market list tab stays selectable from Buying chats");
  } finally {
    await closeBrowser(browser);
  }
}

async function extensionOrigin(browser: Browser): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const fromTargets = browser.targets().map((item) => item.url()).join("\n");
    let fromDebug = "";
    try {
      const tabs = (await fetch(`http://127.0.0.1:${sessionDebugPort}/json`).then((res) =>
        res.json()
      )) as { url?: string }[];
      fromDebug = tabs.map((tab) => tab.url || "").join("\n");
    } catch {
      /* launch path has no debug HTTP port */
    }
    const match = `${fromTargets}\n${fromDebug}`.match(/chrome-extension:\/\/([a-p]{32})/);
    if (match?.[1]) {
      return `chrome-extension://${match[1]}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const seen = browser.targets().map((item) => `${item.type()}:${item.url()}`).join(" | ");
  throw new Error(`no extension target (${seen || "none"})`);
}

async function runLiveSearchPage(): Promise<string> {
  const browser = await launchSessionBrowser();
  try {
    const loginPage = await browser.newPage();
    const loggedIn = await waitForFacebookLogin(loginPage);
    if (!loggedIn) {
      return "search-login-wall";
    }
    await loginPage.close().catch(() => undefined);

    const origin = await extensionOrigin(browser);
    const page = await browser.newPage();
    if (!headed) {
      await page.setViewport({ width: 1400, height: 900 });
    }
    await page.goto(`${origin}/search/search.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#query");
    await page.click("#tab-market");
    await page.waitForFunction(() => {
      const market = document.querySelector('.tab[data-mode="marketplace"]');
      return market?.getAttribute("aria-selected") === "true";
    });
    await page.click("#query", { clickCount: 3 });
    await page.type("#query", "iphone");
    await page.click("#exclude", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.click("button[type=submit]");
    await page.waitForFunction(() => {
      const status = document.querySelector("#status")?.textContent || "";
      const selected = document.querySelector('.tab[aria-selected="true"]')?.textContent || "";
      return /Market list/i.test(selected) && (/Searching Market list/i.test(status) || document.querySelector(".loading-panel"));
    }, { timeout: 8000 });
    await snap(page, "search-loading", "Market list shows search-running status");
    await new Promise((resolve) => setTimeout(resolve, 20000));
    const pages = await browser.pages();
    const market = pages.find((item) => /marketplace\/.*search/i.test(item.url()) && /iphone/i.test(item.url()));
    if (market) {
      await market.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
      await snap(market, "harvest-tab", "Harvest tab opened for Market list search");
    }
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-listing-id]").length > 0,
      { timeout: 60000 }
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await snap(page, "search-page", "Facebook AI Agent page after a live Market list hunt");
    const stats = await page.evaluate(() => ({
      href: location.href,
      status: document.querySelector("#status")?.textContent || "",
      phase: document.querySelector("#phase-label")?.textContent || "",
      phaseAttr: document.querySelector("#status-bar")?.getAttribute("data-phase") || "",
      shown: document.querySelector("#stat-shown")?.textContent || "",
      total: document.querySelector("#stat-total")?.textContent || "",
      match: document.querySelector("#stat-match")?.textContent || "",
      cards: document.querySelectorAll("[data-listing-id]").length,
      tab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim() || "",
      harvested: ((window as Window & { __fbxListings?: { title: string }[] }).__fbxListings || []).map(
        (row) => row.title
      ),
      marketHref: ""
    }));
    stats.marketHref = market?.url() || "";
    console.log("search-page-stats", JSON.stringify(stats, null, 2));
    if (isLoginWall(stats.marketHref)) {
      return "search-login-wall";
    }
    if (stats.cards > 0) {
      return `search-cards:${stats.cards}`;
    }
    return "search-empty";
  } finally {
    await closeBrowser(browser);
  }
}

async function runLivePuppeteer(): Promise<string> {
  const browser = await launchSessionBrowser();
  try {
    const page = await browser.newPage();
    const loggedIn = await waitForFacebookLogin(page);
    if (!loggedIn) {
      return "live-login-wall";
    }
    await page.goto("https://www.facebook.com/marketplace/search/?query=honda%20civic", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const href = page.url();
    const overlay = await page.$("#fbx-exact-root");
    const hidden = await page.$(".fbx-exact-hidden");
    await snap(page, "live", "Live Marketplace search page left untouched");
    if (isLoginWall(href)) {
      return "live-login-wall";
    }
    return overlay || hidden ? "live-altered" : "live-clean";
  } finally {
    await closeBrowser(browser);
  }
}

async function pageStats(page: Page): Promise<{
  href: string;
  status: string;
  cards: number;
  hidden: number;
  visibleTitles: string[];
  hiddenTitles: string[];
}> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];
    const unique = new Map<string, { hidden: boolean; title: string }>();
    for (const node of cards) {
      const href = (node as HTMLAnchorElement).href;
      const id = href.match(/\/marketplace\/item\/(\d+)/)?.[1] || href;
      if (unique.has(id)) {
        continue;
      }
      const hidden = Boolean(node.closest(".fbx-exact-hidden"));
      unique.set(id, {
        hidden,
        title: (node.closest(".fbx-exact-hidden") || node).textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || ""
      });
    }
    const rows = [...unique.values()];
    return {
      href: location.href,
      status: document.querySelector("[data-fbx=status]")?.textContent || "",
      cards: rows.length,
      hidden: rows.filter((row) => row.hidden).length,
      visibleTitles: rows.filter((row) => !row.hidden).slice(0, 8).map((row) => row.title),
      hiddenTitles: rows.filter((row) => row.hidden).slice(0, 8).map((row) => row.title)
    };
  });
}

async function waitForDebugger(port: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      if (data.webSocketDebuggerUrl) {
        return data.webSocketDebuggerUrl;
      }
    } catch {
      /* chrome is still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Chrome Beta debugger did not come up");
}

async function runLiveBetaProfile(): Promise<string> {
  const port = 9222;
  const chrome: ChildProcess = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${betaUserData}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    { stdio: "ignore" }
  );

  let browser: Browser | undefined;
  try {
    const endpoint = await waitForDebugger(port);
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      defaultViewport: { width: 1400, height: 900 }
    });
    const page = await browser.newPage();
    await page.goto("https://www.facebook.com/marketplace/search/?query=honda%20civic%202015", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForSelector('a[href*="/marketplace/item/"]', { timeout: 25000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const css = readFileSync(join(dist, "content", "overlay.css"), "utf8");
    const js = readFileSync(join(dist, "content", "isolated.js"), "utf8");
    const session = await page.createCDPSession();
    await session.send("Runtime.evaluate", {
      expression: `(() => { const s=document.createElement('style'); s.textContent=${JSON.stringify(css)}; document.documentElement.appendChild(s); })();`
    });
    await session.send("Runtime.evaluate", { expression: js });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await page.evaluate(() => window.scrollBy(0, 1400));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stats = await pageStats(page);
    console.log("beta-stats", JSON.stringify(stats, null, 2));
    await snap(page, "beta-search", "Logged-in Marketplace exact-word filter");

    if (stats.href.includes("login") || stats.href.includes("checkpoint")) {
      return "beta-login-wall";
    }
    if (!stats.status && !(await page.$("#fbx-exact-root"))) {
      return "beta-no-overlay";
    }
    if (stats.cards === 0) {
      return "beta-no-cards";
    }
    if (stats.hidden > 0 || /hidden/.test(stats.status)) {
      return `beta-filtered:${stats.hidden}/${stats.cards}`;
    }
    return `beta-overlay:${stats.cards}`;
  } finally {
    if (browser) {
      await browser.disconnect();
    }
    if (chrome.pid) {
      try {
        process.kill(chrome.pid, "SIGTERM");
      } catch {
        /* already closed */
      }
    }
  }
}

async function runChatFixture(mode: "buying" | "selling"): Promise<void> {
  const browser = await launch({
    userDataDir: isolatedUserData,
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const url = pathToFileURL(join(dist, "search", "search.html")).href;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#query");
    await page.click(`.tab[data-mode="${mode}"]`);
    await page.evaluate(
      (payload) => {
        window.postMessage(payload, "*");
      },
      {
        source: "fbx-search",
        type: "snapshot",
        query: "",
        href:
          mode === "buying"
            ? "https://www.facebook.com/marketplace/inbox?targetTab=BUYER"
            : "https://www.facebook.com/marketplace/inbox?targetTab=SELLER",
        mode,
        listings: [
          {
            id: "100200300",
            numericId: "444444",
            title: "Honda Civic 2015",
            description: "Is this still available?",
            price: "",
            photo: "https://example.com/civic.jpg",
            photos: ["https://example.com/civic.jpg"],
            href: "https://www.facebook.com/marketplace/t/100200300/",
            kind: mode,
            party: "Ana Seller"
          },
          {
            id: "200300400",
            numericId: "555555",
            title: "MacBook Pro",
            description: "Can you do 45k?",
            price: "",
            photo: "https://example.com/mac.jpg",
            photos: ["https://example.com/mac.jpg"],
            href: "https://www.facebook.com/marketplace/t/200300400/",
            kind: mode,
            party: "Ben Buyer"
          }
        ]
      }
    );
    await page.waitForFunction(() => document.querySelectorAll("[data-listing-id]").length >= 2);
    await snap(page, `${mode}-list`, `${mode === "buying" ? "Buying" : "Selling"} chats stay on Facebook AI Agent`);
    const rowId = await page.$eval("[data-listing-id]", (node) => node.getAttribute("data-listing-id") || "");
    if (!rowId) {
      throw new Error(`${mode} fixture rendered no listing id`);
    }
    await page.click(`[data-listing-id="${rowId}"]`);
    await page.waitForSelector(".modal-backdrop:not([hidden])");
    await page.waitForFunction(() => {
      const badge = document.querySelector(".modal-info .badge");
      return Boolean(badge && /Buying chat|Selling chat/i.test(badge.textContent || ""));
    });
    if (/facebook\.com/i.test(page.url())) {
      throw new Error(`${mode} click navigated to Facebook: ${page.url()}`);
    }
    await snap(page, `${mode}-modal`, `${mode === "buying" ? "Buying" : "Selling"} chat opens in modal`);
    await page.click(".modal-close");
    await page.waitForSelector(".modal-backdrop[hidden]");
    if (/facebook\.com/i.test(page.url())) {
      throw new Error(`${mode} stayed on Facebook after modal close: ${page.url()}`);
    }
  } finally {
    await closeBrowser(browser);
  }
}

async function runLiveInbox(mode: "buying" | "selling"): Promise<string> {
  const browser = await launchSessionBrowser();
  try {
    const loginPage = await browser.newPage();
    const loggedIn = await waitForFacebookLogin(loginPage);
    if (!loggedIn) {
      return `${mode}-login-wall`;
    }
    await loginPage.close().catch(() => undefined);

    const origin = await extensionOrigin(browser);
    const page = await browser.newPage();
    if (!headed) {
      await page.setViewport({ width: 1400, height: 900 });
    }
    await page.goto(`${origin}/search/search.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#query");
    await page.click(`.tab[data-mode="${mode}"]`);
    await page.waitForFunction(
      (expected) => document.querySelector(`.tab[data-mode="${expected}"]`)?.getAttribute("aria-selected") === "true",
      { timeout: 5000 },
      mode
    );
    await page.waitForSelector(".loading-panel", { timeout: 5000 }).catch(() => undefined);
    await snap(page, `${mode}-live-loading`, `Live ${mode} shows search-running status`);
    await new Promise((resolve) => setTimeout(resolve, 20000));
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-listing-id]").length > 0,
      { timeout: 60000 }
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const cards = await page.$$("[data-listing-id]");
    await snap(page, `${mode}-live-list`, `Live ${mode} chats on Facebook AI Agent`);
    if (!cards.length) {
      return `${mode}-empty`;
    }
    const searchUrl = page.url();
    await cards[0]?.click();
    await page.waitForSelector(".modal-backdrop:not([hidden])", { timeout: 8000 });
    if (/facebook\.com/i.test(page.url()) && !page.url().startsWith(origin)) {
      throw new Error(`${mode} live click left Facebook AI Agent for ${page.url()}`);
    }
    if (page.url() !== searchUrl && !page.url().includes("search.html")) {
      throw new Error(`${mode} live click changed page to ${page.url()}`);
    }
    await snap(page, `${mode}-live-modal`, `Live ${mode} chat modal stays in Facebook AI Agent`);
    await page.click(".modal-close");
    return `${mode}-cards:${cards.length}`;
  } finally {
    await closeBrowser(browser);
  }
}

const fixtureResult = useBetaProfile
  ? "skipped"
  : await runFixture()
      .then(() => "ok")
      .catch((error: Error) => {
        console.error(error.message);
        return "fail";
      });

const buyingFixture = useBetaProfile
  ? "skipped"
  : await runChatFixture("buying")
      .then(() => "ok")
      .catch((error: Error) => {
        console.error(error.message);
        return "fail";
      });

const sellingFixture = useBetaProfile
  ? "skipped"
  : await runChatFixture("selling")
      .then(() => "ok")
      .catch((error: Error) => {
        console.error(error.message);
        return "fail";
      });

const liveResult = useBetaProfile
  ? "skipped"
  : await runLivePuppeteer().catch((error: Error) => {
      console.error(error.message);
      return "live-error";
    });

const searchResult = useBetaProfile
  ? "skipped"
  : await runLiveSearchPage().catch((error: Error) => {
      console.error(error.message);
      return "search-error";
    });

const buyingLive = useBetaProfile
  ? "skipped"
  : await runLiveInbox("buying").catch((error: Error) => {
      console.error(error.message);
      return "buying-error";
    });

const sellingLive = useBetaProfile
  ? "skipped"
  : await runLiveInbox("selling").catch((error: Error) => {
      console.error(error.message);
      return "selling-error";
    });

await closeSharedLiveBrowser();

const betaResult = useBetaProfile
  ? await runLiveBetaProfile().catch((error: Error) => {
      console.error(error.message);
      return "beta-error";
    })
  : "skipped";

if (wantReport || wantShots) {
  const file = writeReport();
  if (wantShots) {
    for (const shot of shots) {
      writeFileSync(join(reportDir, `${shot.name}.png`), shot.png);
    }
  }
  console.log(`report=${file}`);
}

console.log(`fixture=${fixtureResult}`);
console.log(`buying-fixture=${buyingFixture}`);
console.log(`selling-fixture=${sellingFixture}`);
console.log(`live=${liveResult}`);
console.log(`search=${searchResult}`);
console.log(`buying-live=${buyingLive}`);
console.log(`selling-live=${sellingLive}`);
console.log(`beta=${betaResult}`);

if (
  fixtureResult === "fail" ||
  buyingFixture === "fail" ||
  sellingFixture === "fail" ||
  liveResult === "live-altered" ||
  String(betaResult).startsWith("beta-error") ||
  betaResult === "beta-login-wall"
) {
  process.exitCode = 1;
}
