import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cookiesPath = join(root, ".idea", "facebook-cookies.json");
const outPath = join(root, ".idea", "inbox-graphql-sample.json");
const chrome = existsSync("/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta")
  ? "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: join(root, ".idea", "chrome-user-data-inbox-probe"),
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
          if (!/marketplaceInboxBuyerMessageThreads|marketplaceInboxSellerMessageThreads/i.test(text)) {
            return;
          }
          saved = true;
          writeFileSync(outPath, text.slice(0, 200000));
          console.log(`saved=${outPath} bytes=${Math.min(text.length, 200000)}`);
        })
        .catch(() => undefined);
    });
    if (existsSync(cookiesPath)) {
      await page.setCookie(...(JSON.parse(readFileSync(cookiesPath, "utf8")) as never[]));
    }
    await page.goto("https://www.facebook.com/marketplace/inbox?targetTab=BUYER", {
      waitUntil: "networkidle2",
      timeout: 90000
    });
    await new Promise((resolve) => setTimeout(resolve, 6000));
  } finally {
    await browser.close();
  }
}

void main();
