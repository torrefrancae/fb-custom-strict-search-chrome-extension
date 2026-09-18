import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const reportDir = join(root, ".idea", "report");
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => !arg.startsWith("--query=")));
const query =
  args.find((arg) => arg.startsWith("--query="))?.slice("--query=".length) || "ninja 300";
const querySlug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "search";
const wantShots = flags.has("--screenshots") || flags.has("--html-report");

type Shot = { name: string; title: string; png: Buffer };
const shots: Shot[] = [];

async function snap(
  page: Page,
  name: string,
  title: string,
  clip?: { x: number; y: number; width: number; height: number }
): Promise<void> {
  if (!wantShots) {
    return;
  }
  shots.push({
    name,
    title,
    png: Buffer.from(await page.screenshot({ fullPage: false, type: "png", clip }))
  });
}

async function snapPanel(page: Page, name: string, title: string): Promise<void> {
  const clip = await page.evaluate(() => {
    const node = document.getElementById("fbx-exact-root");
    if (!node) {
      return null;
    }
    const box = node.getBoundingClientRect();
    const pad = 10;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    return {
      x,
      y,
      width: Math.min(window.innerWidth - x, Math.ceil(box.width + pad * 2)),
      height: Math.min(window.innerHeight - y, Math.ceil(box.height + pad * 2))
    };
  });
  if (clip && clip.width > 8 && clip.height > 8) {
    await snap(page, name, title, clip);
    return;
  }
  await snap(page, name, title);
}

const version = await fetch("http://127.0.0.1:9333/json/version").then((res) => res.json()) as {
  webSocketDebuggerUrl: string;
};

const browser = await puppeteer.connect({
  browserWSEndpoint: version.webSocketDebuggerUrl,
  defaultViewport: null
});

const pages = await browser.pages();
const page =
  pages.find((item) => item.url().includes("facebook.com")) || (await browser.newPage());

await page.goto(`https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`, {
  waitUntil: "domcontentloaded",
  timeout: 45000
});
await page.waitForSelector('a[href*="/marketplace/item/"]', { timeout: 25000 }).catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 2500));
for (const offset of [1400, 2800, 4200]) {
  await page.evaluate((y) => window.scrollTo(0, y), offset);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((resolve) => setTimeout(resolve, 800));

const css = readFileSync(join(dist, "content", "overlay.css"), "utf8");
const js = readFileSync(join(dist, "content", "isolated.js"), "utf8");
const session = await page.createCDPSession();
await session.send("Runtime.evaluate", {
  expression:
    "window.__fbxExactIsolated=false;document.getElementById('fbx-exact-root')?.remove();document.querySelectorAll('.fbx-exact-hidden,[data-fbx-exact],[data-fbx-gap],[data-fbx-noise]').forEach((n)=>{n.classList.remove('fbx-exact-hidden');n.removeAttribute('data-fbx-exact');n.removeAttribute('data-fbx-gap');n.removeAttribute('data-fbx-noise');});"
});
await session.send("Runtime.evaluate", {
  expression: `(() => { const s=document.createElement('style'); s.id='fbx-exact-style'; s.textContent=${JSON.stringify(css)}; document.documentElement.appendChild(s); })();`
});
await session.send("Runtime.evaluate", { expression: js });
await new Promise((resolve) => setTimeout(resolve, 2500));

const stats = await page.evaluate(() => {
  const marks = [...document.querySelectorAll("mark.fbx-exact-mark")].map((node) =>
    (node.textContent || "").trim()
  );
  const status = document.querySelector("[data-fbx=status]")?.textContent || "";
  const match = document.querySelector("[data-fbx=match]")?.textContent || "";
  const queryText = document.querySelector("[data-fbx=query]")?.textContent || "";
  const shownText = document.querySelector("[data-fbx=shown]")?.textContent || "";
  const hiddenText = document.querySelector("[data-fbx=hidden]")?.textContent || "";
  const adsText = document.querySelector("[data-fbx=ads]")?.textContent || "";
  const hidden = document.querySelectorAll(".fbx-exact-hidden").length;
  const ads = document.querySelectorAll("[data-fbx-noise]").length;
  const visible = [...document.querySelectorAll('a[href*="/marketplace/item/"]')].filter(
    (node) => !node.closest(".fbx-exact-hidden")
  );
  const first = visible[0]?.getBoundingClientRect();
  const href = location.href;
  const login = /login|checkpoint/i.test(href);
  const titles = visible.slice(0, 6).map((node) =>
    (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
  );
  const hiddenTitles = [...document.querySelectorAll('a[href*="/marketplace/item/"]')]
    .filter((node) => node.closest(".fbx-exact-hidden"))
    .slice(0, 8)
    .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70));
  const uniqueRoots = new Set(
    [...document.querySelectorAll('a[href*="/marketplace/item/"]')].map((node) =>
      node.closest(".fbx-exact-hidden, [data-fbx-hl]") || node
    )
  ).size;
  return {
    status,
    match,
    queryText,
    shownText,
    hiddenText,
    adsText,
    hidden,
    ads,
    marks: marks.slice(0, 12),
    href,
    login,
    visibleCount: visible.length,
    titles,
    hiddenTitles,
    uniqueRoots,
    firstLeft: first ? Math.round(first.left) : null,
    firstTop: first ? Math.round(first.top) : null
  };
});

console.log("session-stats", JSON.stringify(stats, null, 2));
await snap(page, `session-${querySlug}`, `Logged-in ${query} search with packed exact matches`);
await snap(page, `panel-${querySlug}-dock`, `Dashboard docked under the Marketplace search box`);
await snapPanel(page, `dashboard-${querySlug}`, `Tiny search dashboard close-up`);

const handleBox = await page.$eval("[data-fbx=handle]", (node) => {
  const box = node.getBoundingClientRect();
  return { x: box.x + 18, y: box.y + 8 };
}).catch(() => null);
if (handleBox) {
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(36, 280, { steps: 16 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 800));
  await snap(page, `panel-${querySlug}-left`, `Dashboard flung to the left edge`);
  await snapPanel(page, `dashboard-${querySlug}-left`, `Tiny search dashboard after snap`);
}

if (wantShots) {
  mkdirSync(reportDir, { recursive: true });
  for (const shot of shots) {
    writeFileSync(join(reportDir, `${shot.name}.png`), shot.png);
  }
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Logged-in Marketplace session</title>
    <style>
      body { font-family: Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      img { max-width: 100%; border: 1px solid #ccc; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <h1>Logged-in Marketplace session</h1>
    <p>Exact-word filter plus highlighted matches.</p>
    ${shots
      .map(
        (shot, index) =>
          `<figure><figcaption>Figure ${index + 1}.0 ${shot.title}</figcaption><img alt="${shot.title}" src="data:image/png;base64,${shot.png.toString("base64")}" /></figure>`
      )
      .join("\n")}
  </body>
</html>`;
  writeFileSync(join(reportDir, `session-${querySlug}.html`), html);
}

await browser.disconnect();

if (stats.login) {
  console.log("session=login-wall");
  process.exitCode = 1;
} else if (!stats.status) {
  console.log("session=no-overlay");
  process.exitCode = 1;
} else if (stats.visibleCount > 0 && stats.marks.length === 0) {
  console.log("session=no-highlights");
  process.exitCode = 1;
} else if (stats.visibleCount > 0 && stats.firstTop != null && stats.firstTop > 520) {
  console.log("session=gappy-layout");
  process.exitCode = 1;
} else {
  console.log("session=ok");
}
