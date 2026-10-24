import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const sessionUserData = join(root, ".idea", "chrome-session-marketplace");
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

async function saveCookies(page: Page): Promise<void> {
  const cookies = await page.cookies("https://www.facebook.com", "https://www.facebook.com/");
  if (!cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value))) {
    return;
  }
  writeFileSync(facebookCookieJar, JSON.stringify(cookies, null, 2));
}

const browser = await launchBrowser();
try {
  const boot = await browser.newPage();
  await restoreCookies(boot);
  await boot.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await boot.goto("https://www.facebook.com/marketplace/", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  const cookies = await boot.cookies("https://www.facebook.com", "https://www.facebook.com/");
  if (!cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value))) {
    throw new Error("not logged in");
  }
  await saveCookies(boot);
  await boot.close();

  const origin = await extensionOrigin(browser);
  console.log(`origin=${origin}`);
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (/fbx|hunt|harvest|loading|final/i.test(msg.text())) {
      console.log("console", msg.text());
    }
  });

  await page.goto(`${origin}/search/search.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#query");
  await page.click("#tab-market");
  await page.waitForFunction(
    () => document.querySelector('.tab[data-mode="marketplace"]')?.getAttribute("aria-selected") === "true",
    { timeout: 5000 }
  );
  await page.click("#query", { clickCount: 3 });
  await page.type("#query", "iphone");
  await page.click("button[type=submit]");

  let sawLoadingMore = false;
  let sawFinal = false;
  let maxCards = 0;
  const phases: string[] = [];

  for (let attempt = 0; attempt < 75; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const stats = await page.evaluate(() => {
      const phase = document.querySelector("#phase-label")?.textContent || "";
      const status = document.querySelector("#status")?.textContent || "";
      const cards = document.querySelectorAll("[data-listing-id]").length;
      const banner = Boolean(document.querySelector(".loading-banner"));
      const panel = Boolean(document.querySelector(".loading-panel"));
      return { phase, status, cards, banner, panel };
    });
    maxCards = Math.max(maxCards, stats.cards);
    phases.push(`${stats.phase}:${stats.cards}`);
    console.log("tick", stats);
    if (/Loading more|not final|Keep waiting|partial/i.test(`${stats.phase} ${stats.status}`) || stats.banner) {
      sawLoadingMore = true;
    }
    if (/^Final$/i.test(stats.phase) || /Final results/i.test(stats.status)) {
      /*
       * Final must hold for a few ticks. Premature Final that flips back to
       * Loading more is still a failure.
       */
      let held = true;
      for (let hold = 0; hold < 3; hold += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const again = await page.evaluate(() => ({
          phase: document.querySelector("#phase-label")?.textContent || "",
          cards: document.querySelectorAll("[data-listing-id]").length
        }));
        maxCards = Math.max(maxCards, again.cards);
        phases.push(`${again.phase}:${again.cards}`);
        console.log("hold", again);
        if (!/^Final$/i.test(again.phase)) {
          held = false;
          break;
        }
      }
      if (held) {
        sawFinal = true;
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(join(reportDir, "live-marketplace-final.png"), await page.screenshot({ type: "png" }));
        break;
      }
    }
  }

  console.log(
    `marketplace-live=cards:${maxCards};loadingMore:${sawLoadingMore};final:${sawFinal};phases:${phases.join(">")}`
  );
  if (maxCards <= 0 || !sawLoadingMore || !sawFinal) {
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => undefined);
}
