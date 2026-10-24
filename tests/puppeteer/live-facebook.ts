import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const sessionUserData = join(root, ".idea", "chrome-session-facebook");
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

const browser = await launchBrowser();
try {
  const boot = await browser.newPage();
  await restoreCookies(boot);
  await boot.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  const cookies = await boot.cookies("https://www.facebook.com");
  if (!cookies.some((cookie) => cookie.name === "c_user")) {
    throw new Error("not logged in");
  }
  await boot.close();

  const origin = await extensionOrigin(browser);
  console.log(`origin=${origin}`);
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (/fbx|harvest|facebook/i.test(msg.text())) {
      console.log("console", msg.text());
    }
  });
  browser.on("targetcreated", (target) => {
    void target.page().then((tab) => {
      tab?.on("console", (msg) => {
        if (/fbx|harvest|facebook/i.test(msg.text())) {
          console.log("tab-console", msg.text());
        }
      });
    });
  });

  await page.goto(`${origin}/search/search.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#query");
  const tabOrder = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".tab")].map((button) => button.dataset.mode || "")
  );
  console.log(`tabs=${tabOrder.join(",")}`);
  if (tabOrder[0] !== "facebook" || tabOrder[1] !== "marketplace") {
    throw new Error(`bad tab order: ${tabOrder.join(",")}`);
  }

  await page.click("#tab-facebook");
  await page.waitForFunction(
    () => document.querySelector('.tab[data-mode="facebook"]')?.getAttribute("aria-selected") === "true",
    { timeout: 5000 }
  );
  await page.click("#query", { clickCount: 3 });
  await page.type("#query", "honda civic");
  await page.click("button[type=submit]");

  const seen: number[] = [];
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (attempt % 5 === 0) {
      const pages = [];
      for (const tab of await browser.pages()) {
        const url = tab.url();
        if (!/facebook\.com/i.test(url) && !/chrome-extension:/i.test(url)) {
          continue;
        }
        const info = await tab
          .evaluate(() => ({
            href: location.href,
            main: Boolean((window as Window & { __fbxExactMain?: boolean }).__fbxExactMain),
            mode: (window as Window & { __fbxHarvestMode?: string }).__fbxHarvestMode || ""
          }))
          .catch(() => ({ href: url, main: false, mode: "unreachable" }));
        pages.push(info);
      }
      console.log("pages", JSON.stringify(pages));
    }
    const stats = await page.evaluate(() => {
      const meta = document.querySelector("#status")?.textContent || "";
      const cards = document.querySelectorAll("[data-listing-id]").length;
      const tab = document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim() || "";
      const badge = document.querySelector(".result-row .badge")?.textContent || "";
      const usable =
        ((window as Window & { __fbxListings?: unknown[] }).__fbxListings || []).length;
      return { meta, cards, tab, badge, usable };
    });
    seen.push(stats.cards);
    console.log("tick", stats);
    if (stats.cards > 0) {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(join(reportDir, "live-facebook-ok.png"), await page.screenshot({ type: "png" }));
      const harvest = (await browser.pages()).find((item) =>
        /facebook\.com\/search\/posts/i.test(item.url())
      );
      console.log(
        `facebook-live=cards:${stats.cards};usable:${stats.usable};badge:${stats.badge};harvest:${harvest?.url() || ""}`
      );
      process.exitCode = 0;
      await page.close();
      break;
    }
  }
  if (!seen.some((count) => count > 0)) {
    for (const tab of await browser.pages()) {
      if (/facebook\.com\/search/i.test(tab.url())) {
        console.log(
          "harvest-tab",
          await tab
            .evaluate(() => ({
              url: location.href,
              main: Boolean((window as Window & { __fbxExactMain?: boolean }).__fbxExactMain),
              isolated: Boolean((window as Window & { __fbxExactIsolated?: boolean }).__fbxExactIsolated)
            }))
            .catch(() => null)
        );
      }
    }
    console.log(`facebook-live=empty;ticks:${seen.join(">")}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => undefined);
}
