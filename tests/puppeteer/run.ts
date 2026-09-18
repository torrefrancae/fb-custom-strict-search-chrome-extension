import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

type Shot = { name: string; title: string; png: Buffer };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const fixture = join(root, "tests", "fixtures", "marketplace.html");
const reportDir = join(root, ".idea", "report");
const isolatedUserData = join(root, ".idea", "chrome-user-data");
const betaUserData = join(root, ".idea", "chrome-beta-clone");
const chromeBeta =
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta";

const flags = new Set(process.argv.slice(2));
const wantShots = flags.has("--screenshots");
const wantReport = flags.has("--html-report");
const useBetaProfile = flags.has("--beta-profile");
const shots: Shot[] = [];

async function launch(options?: {
  userDataDir: string;
  headless: boolean;
  profile?: string;
}): Promise<Browser> {
  const dataDir = options?.userDataDir || isolatedUserData;
  mkdirSync(dataDir, { recursive: true });
  const args = ["--no-first-run", "--no-default-browser-check"];
  if (options?.profile) {
    args.push(`--profile-directory=${options.profile}`);
  }
  return puppeteer.launch({
    executablePath: chromeBeta,
    headless: options?.headless ?? true,
    pipe: true,
    enableExtensions: [dist],
    userDataDir: dataDir,
    args
  });
}

async function closeBrowser(browser: Browser): Promise<void> {
  const proc = browser.process();
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]);
  if (proc && !proc.killed) {
    proc.kill("SIGKILL");
  }
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
    <title>Exact Marketplace Search test report</title>
    <style>
      body { font-family: Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      img { max-width: 100%; border: 1px solid #ccc; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <h1>Exact Marketplace Search test report</h1>
    <p>Fixture and live checks for all-word title and description matching.</p>
    ${figures}
  </body>
</html>`;
  const file = join(reportDir, "exact-search-test.html");
  writeFileSync(file, html);
  return file;
}

async function runFixture(): Promise<void> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const url = `${pathToFileURL(fixture).href}?query=civic%202015`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ path: join(dist, "content", "overlay.css") });
    await page.addScriptTag({ path: join(dist, "content", "isolated.js") });
    await page.evaluate(() => {
      window.postMessage(
        {
          source: "fbx-exact",
          type: "listings",
          listings: [
            {
              id: "111111111111",
              numericId: "111111111111",
              title: "Honda Civic 2015",
              description: "One owner, garage kept"
            },
            {
              id: "222222222222",
              numericId: "222222222222",
              title: "Toyota Vios 2018",
              description: "Honda mats included"
            },
            {
              id: "333333333333",
              numericId: "333333333333",
              title: "Civic Hatchback",
              description: "2015 model year, clean papers"
            }
          ]
        },
        "*"
      );
    });

    await page.waitForFunction(() => {
      const status = document.querySelector("[data-fbx=status]")?.textContent || "";
      const hidden = [...document.querySelectorAll(".fbx-exact-hidden a")].map((node) =>
        (node as HTMLAnchorElement).getAttribute("href")
      );
      return (
        status.includes("2 exact matches kept, 1 hidden") &&
        hidden.some((href) => href?.includes("222222222222"))
      );
    });

    await snap(page, "fixture", "Fixture grid after exact-word filter");
  } finally {
    await closeBrowser(browser);
  }
}

async function runLivePuppeteer(): Promise<string> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto("https://www.facebook.com/marketplace/search/?query=honda%20civic", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const href = page.url();
    const overlay = await page.$("#fbx-exact-root");
    await snap(page, "live", "Live Marketplace search page");
    if (href.includes("login") || href.includes("checkpoint")) {
      return "live-login-wall";
    }
    return overlay ? "live-overlay" : "live-no-overlay";
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
    chromeBeta,
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

const fixtureResult = useBetaProfile
  ? "skipped"
  : await runFixture()
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
console.log(`live=${liveResult}`);
console.log(`beta=${betaResult}`);

if (fixtureResult === "fail" || String(betaResult).startsWith("beta-error") || betaResult === "beta-login-wall" || betaResult === "beta-no-overlay") {
  process.exitCode = 1;
}
