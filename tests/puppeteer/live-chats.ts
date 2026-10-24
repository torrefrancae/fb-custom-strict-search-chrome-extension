import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const sessionUserData = join(root, ".idea", "chrome-session");
const facebookCookieJar = join(root, ".idea", "facebook-cookies.json");
const reportDir = join(root, ".idea", "report");
const chromePath = existsSync("/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta")
  ? "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function clearLocks(): void {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      execSync(`rm -f "${join(sessionUserData, name)}"`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    execSync(`pkill -f "user-data-dir=${sessionUserData}"`, { stdio: "ignore" });
  } catch {
    /* none */
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  clearLocks();
  mkdirSync(sessionUserData, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    pipe: true,
    enableExtensions: [dist],
    userDataDir: sessionUserData,
    defaultViewport: { width: 1400, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"]
  });
}

async function extensionOrigin(browser: Browser): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const match = browser
      .targets()
      .map((item) => item.url())
      .join("\n")
      .match(/chrome-extension:\/\/([a-p]{32})/);
    if (match?.[1]) {
      return `chrome-extension://${match[1]}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("no extension target");
}

async function restoreCookies(page: Page): Promise<void> {
  if (!existsSync(facebookCookieJar)) {
    return;
  }
  const cookies = JSON.parse(readFileSync(facebookCookieJar, "utf8")) as never[];
  await page.setCookie(...cookies);
}

async function runMode(browser: Browser, origin: string, mode: "buying" | "selling"): Promise<string> {
  const page = await browser.newPage();
  const onConsole = (label: string) => (msg: { text: () => string }) => {
    if (/fbx|harvest|cache|inbox/i.test(msg.text())) {
      console.log(`${label}-console`, msg.text());
    }
  };
  page.on("console", onConsole(mode));
  browser.on("targetcreated", (target) => {
    void target.page().then((tab) => {
      tab?.on("console", onConsole(`${mode}-tab`));
    });
  });
  await page.goto(`${origin}/search/search.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#query");
  await page.evaluate(() => {
    const box = document.querySelector<HTMLInputElement>("#query");
    if (box) {
      box.value = "";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.click(`.tab[data-mode="${mode}"]`);
  await page.waitForFunction(
    (expected) => document.querySelector(`.tab[data-mode="${expected}"]`)?.getAttribute("aria-selected") === "true",
    { timeout: 5000 },
    mode
  );

  const seen: number[] = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    for (const tab of await browser.pages()) {
      if (/marketplace\/inbox/i.test(tab.url())) {
        tab.off("console", onConsole(`${mode}-tab`));
        tab.on("console", onConsole(`${mode}-tab`));
      }
    }
    const stats = await page.evaluate((expected) => {
      const meta = document.querySelector(`#tab-${expected}-meta`)?.textContent || "";
      const cards = document.querySelectorAll("[data-listing-id]").length;
      const count = Number((meta.match(/(\d+)/) || [])[1] || 0);
      return { meta, cards, count };
    }, mode);
    seen.push(stats.count);
    console.log(`${mode}-tick`, stats);
    if (stats.count > 0 && (stats.cards >= stats.count || attempt >= 8)) {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(join(reportDir, `live-${mode}-ok.png`), await page.screenshot({ type: "png" }));
      await page.close();
      return `${mode}-cards:${stats.cards};cache:${stats.count};ticks:${seen.join(">")}`;
    }
  }

  for (const tab of await browser.pages()) {
    const url = tab.url();
    if (!/marketplace\/inbox/i.test(url)) {
      continue;
    }
    const dump = await tab
      .evaluate(() => ({
        url: location.href,
        main: Boolean((window as Window & { __fbxExactMain?: boolean }).__fbxExactMain),
        isolated: Boolean((window as Window & { __fbxExactIsolated?: boolean }).__fbxExactIsolated),
        buttons: document.querySelectorAll('[role="button"][tabindex="0"]').length
      }))
      .catch(() => null);
    console.log(`${mode}-inbox-tab`, dump);
  }

  await page.close();
  return `${mode}-empty;ticks:${seen.join(">")}`;
}

const browser = await launchBrowser();
try {
  const boot = await browser.newPage();
  await restoreCookies(boot);
  await boot.goto("https://www.facebook.com/marketplace/", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  const cookies = await boot.cookies("https://www.facebook.com");
  if (!cookies.some((cookie) => cookie.name === "c_user")) {
    throw new Error("not logged in");
  }
  await boot.close();
  const origin = await extensionOrigin(browser);
  console.log(`origin=${origin}`);
  const buying = await runMode(browser, origin, "buying");
  const selling = await runMode(browser, origin, "selling");
  console.log(`buying-live=${buying}`);
  console.log(`selling-live=${selling}`);
  if (buying.includes("empty") || selling.includes("empty")) {
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => undefined);
}
