import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PROFILE_DIR =
  process.env.AIC_BROWSER_PROFILE_DIR?.trim() ||
  join(MODULE_DIR, ".aic-browser-profile");

function loadEnvFile() {
  const envPath = join(MODULE_DIR, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function buildUpstreamHeaders() {
  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.artic.edu/",
    "AIC-User-Agent": "ascii-art-museum (https://hhong621.github.io/ARTIC-ASCII/)",
  };

  const cookie = process.env.AIC_UPSTREAM_COOKIE?.trim();
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

function isBrowserFallbackEnabled() {
  const value = process.env.AIC_USE_BROWSER?.trim().toLowerCase();
  if (value === "0" || value === "false") return false;
  return true;
}

function isHeadedBrowser() {
  return process.env.AIC_BROWSER_HEADED?.trim() === "1";
}

async function fetchViaHttp(url) {
  const response = await fetch(url, {
    headers: buildUpstreamHeaders(),
    redirect: "follow",
  });

  const contentType = response.headers.get("content-type") || "";
  const isImage = contentType.includes("image/");

  return {
    ok: response.ok && isImage,
    status: response.status,
    contentType: isImage ? contentType : "application/json",
    body: Buffer.from(await response.arrayBuffer()),
    blockedByCloudflare: response.status === 403 && contentType.includes("text/html"),
  };
}

async function addCookiesToContext(context, url) {
  const cookie = process.env.AIC_UPSTREAM_COOKIE?.trim();
  if (!cookie) return;

  const hostname = new URL(url).hostname;
  const cookies = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name || !value) return null;
      return {
        name,
        value,
        domain: hostname,
        path: "/",
      };
    })
    .filter(Boolean);

  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
}

async function fetchViaBrowser(url) {
  const { chromium } = await import("playwright-core");
  const headless = !isHeadedBrowser();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless,
    userAgent: BROWSER_UA,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await addCookiesToContext(context, url);

    // Establish an artic.edu session before requesting IIIF assets.
    await page.goto("https://www.artic.edu/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
    if (!response) {
      throw new Error("No response from artic.edu");
    }

    const status = response.status();
    const headers = response.headers();
    const contentType = headers["content-type"] || "image/jpeg";
    const body = Buffer.from(await response.body());
    const isImage = contentType.includes("image/");

    return {
      ok: status >= 200 && status < 300 && isImage,
      status,
      contentType: isImage ? contentType : "application/json",
      body,
      blockedByCloudflare: status === 403 && contentType.includes("text/html"),
    };
  } finally {
    await context.close();
  }
}

/**
 * Fetch an IIIF image from artic.edu.
 * Node fetch is often blocked by Cloudflare; falls back to Chrome when enabled.
 */
export async function fetchUpstreamImage(url) {
  const httpResult = await fetchViaHttp(url);
  if (httpResult.ok) {
    return httpResult;
  }

  if (httpResult.blockedByCloudflare && isBrowserFallbackEnabled()) {
    try {
      console.warn("artic.edu returned 403; retrying with Chrome...");
      const browserResult = await fetchViaBrowser(url);
      if (browserResult.ok) {
        return browserResult;
      }
      return browserResult;
    } catch (error) {
      console.error("Chrome fetch failed:", error.message);
      return {
        ok: false,
        status: httpResult.status,
        contentType: "application/json",
        body: null,
        blockedByCloudflare: true,
        browserError: error.message,
      };
    }
  }

  return httpResult;
}

export function buildUpstreamErrorPayload(result) {
  const payload = {
    error: "Upstream image unavailable",
    status: result.status,
  };

  if (result.blockedByCloudflare) {
    payload.hint =
      "artic.edu blocked this request via Cloudflare. Local fix: run `npm run setup-browser` in proxy/ (visible Chrome, one-time), or set AIC_UPSTREAM_COOKIE in proxy/.env. Production needs a hosted browser profile or contact engineering@artic.edu.";
  }

  if (result.browserError) {
    payload.browserError = result.browserError;
  }

  return payload;
}
