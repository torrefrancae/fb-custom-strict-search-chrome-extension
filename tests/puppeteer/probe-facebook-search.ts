import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cookiesPath = join(root, ".idea", "facebook-cookies.json");
const outPath = join(root, ".idea", "facebook-search-sample.json");
const chrome = existsSync("/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta")
  ? "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main(): Promise<void> {
  mkdirSync(join(root, ".idea"), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: join(root, ".idea", "chrome-user-data-fb-search-probe"),
    args: ["--no-first-run", "--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = await browser.newPage();
    let saved = false;
    page.on("response", (response) => {
      if (saved || !/api\/graphql/i.test(response.url())) {
        return;
      }
      void response
        .text()
        .then((text) => {
          if (!/SearchPostViewModel|serpResponse|TOP_PUBLIC_POSTS/i.test(text)) {
            return;
          }
          if (text.length < 5000 || text.length > 900000) {
            return;
          }
          try {
            JSON.parse(text.replace(/^for \(;;\);/, "").trim());
          } catch {
            return;
          }
          saved = true;
          writeFileSync(outPath, text);
          console.log(`saved=${outPath} bytes=${text.length}`);
        })
        .catch(() => undefined);
    });
    if (existsSync(cookiesPath)) {
      await page.setCookie(...(JSON.parse(readFileSync(cookiesPath, "utf8")) as never[]));
    }
    await page.goto("https://www.facebook.com/search/posts/?q=honda%20civic", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });
    for (let i = 0; i < 8; i += 1) {
      await page.evaluate(() => window.scrollBy(0, 1400));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (saved) {
        break;
      }
    }
    const dump = await page.evaluate(() => {
      const articles = [...document.querySelectorAll('[role="article"]')];
      return {
        href: location.href,
        articles: articles.length,
        sample: articles.slice(0, 3).map((node) => {
          const root = node as HTMLElement;
          const links = [...root.querySelectorAll("a[href]")]
            .map((a) => (a as HTMLAnchorElement).href.split("?")[0] || "")
            .filter((href) => /facebook\.com\//i.test(href))
            .slice(0, 8);
          const imgs = [...root.querySelectorAll("img")]
            .map((img) => img.currentSrc || img.src)
            .filter((src) => /^https:\/\//i.test(src))
            .slice(0, 4);
          return {
            text: (root.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 12),
            links,
            imgs
          };
        })
      };
    });
    console.log("dom", JSON.stringify(dump, null, 2));
    console.log(`savedFlag=${saved}`);
  } finally {
    await browser.close();
  }
}

void main();
