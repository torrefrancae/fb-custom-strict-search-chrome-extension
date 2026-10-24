import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const sessionUserData = join(root, ".idea", "chrome-session-agent-shell");
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
  await new Promise((resolve) => setTimeout(resolve, 1000));
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
  await page.setCookie(...(JSON.parse(readFileSync(facebookCookieJar, "utf8")) as never[]));
}

const browser = await launchBrowser();
try {
  const boot = await browser.newPage();
  await restoreCookies(boot);
  await boot.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  const cookies = await boot.cookies("https://www.facebook.com", "https://www.facebook.com/");
  if (!cookies.some((cookie) => cookie.name === "c_user" && Boolean(cookie.value))) {
    throw new Error("not logged in");
  }
  await boot.close();

  const origin = await extensionOrigin(browser);
  console.log(`origin=${origin}`);

  const page = await browser.newPage();
  await page.goto(`${origin}/search/search.html?embed=1`, {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });
  await page.waitForSelector("#query");
  const embed = await page.evaluate(() => document.body.classList.contains("embed"));
  await page.click("#tab-market");
  await page.click("#query", { clickCount: 3 });
  await page.type("#query", "iphone");
  await page.click("button[type=submit]");

  let shellOk = false;
  let frameEmbed = false;
  let cards = 0;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pages = await browser.pages();
    if (attempt % 5 === 0) {
      console.log(
        "tabs",
        attempt,
        pages.map((tab) => tab.url())
      );
    }
    for (const tab of pages) {
      const url = tab.url();
      if (!/facebook\.com/i.test(url)) {
        continue;
      }
      const stats = await tab
        .evaluate(() => {
          const shell = document.getElementById("fbx-agent-shell");
          const frame = shell?.querySelector("iframe") as HTMLIFrameElement | null;
          return {
            shell: Boolean(shell && !shell.hidden),
            frameSrc: frame?.src || "",
            embed: /embed=1/.test(frame?.src || ""),
            hasRoot: Boolean(shell)
          };
        })
        .catch(() => ({ shell: false, frameSrc: "", embed: false, hasRoot: false }));
      console.log("fb-tab", { url, ...stats, attempt });
      if (stats.shell && stats.embed) {
        shellOk = true;
        frameEmbed = true;
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(join(reportDir, "live-agent-shell.png"), await tab.screenshot({ type: "png" }));
        const frame = await tab.$("iframe.fbx-agent-frame");
        if (frame) {
          const framePage = await frame.contentFrame();
          if (framePage) {
            cards = await framePage.evaluate(() => document.querySelectorAll("[data-listing-id]").length);
          }
        }
        break;
      }
    }
    if (shellOk) {
      break;
    }
  }

  console.log(`agent-shell-live=shell:${shellOk};embed:${frameEmbed};cards:${cards};bootEmbed:${embed}`);
  if (!shellOk || !frameEmbed || !embed) {
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => undefined);
}
