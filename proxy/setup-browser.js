import { createInterface } from "node:readline";
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".aic-browser-profile");
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

console.log("Opening Chrome to establish an artic.edu session...");
console.log("If Cloudflare shows a challenge, complete it in the browser window.");

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chrome",
  headless: false,
  userAgent: BROWSER_UA,
});

const page = context.pages()[0] || await context.newPage();
await page.goto("https://www.artic.edu/", { waitUntil: "domcontentloaded" });

const testUrl =
  "https://www.artic.edu/iiif/2/fea45553-ebe4-0c67-92a3-c408617843a2/full/843,/0/default.jpg";
const testResponse = await page.goto(testUrl, { waitUntil: "load" });
const testType = testResponse?.headers()["content-type"] || "unknown";
console.log(`Test image response: ${testResponse?.status() ?? "no response"} (${testType})`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => {
  rl.question("Press Enter to save the browser profile and exit...", () => {
    rl.close();
    resolve();
  });
});

await context.close();
console.log("Browser profile saved. Restart the proxy with `npm run dev`.");
