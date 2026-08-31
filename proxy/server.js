import express from "express";

const PORT = process.env.PORT || 3001;
const MET_API_ORIGIN = "https://collectionapi.metmuseum.org";
const MET_IMAGE_HOST = "images.metmuseum.org";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hhong621.github.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3456",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3456",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5500",
];

function getAllowedOrigins() {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function cors(req, res, next) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
}

function isAllowedMetImageUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === MET_IMAGE_HOST;
  } catch {
    return false;
  }
}

const app = express();
app.use(cors);

app.use("/met-api/public/collection/v1", async (req, res) => {
  const upstreamUrl = `${MET_API_ORIGIN}/public/collection/v1${req.url}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      redirect: "follow",
    });

    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json",
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(body);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch Met API",
      message: error.message,
    });
  }
});

app.get("/met-image", async (req, res) => {
  const src = req.query.src;

  if (!src || typeof src !== "string") {
    return res.status(400).json({ error: "Missing required query parameter: src" });
  }

  if (!isAllowedMetImageUrl(src)) {
    return res.status(400).json({ error: "Invalid Met image URL" });
  }

  try {
    const upstream = await fetch(src, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "",
      },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.includes("image/")) {
      return res.status(upstream.ok ? 502 : upstream.status).json({
        error: "Upstream image unavailable",
        status: upstream.status,
      });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.send(body);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch upstream image",
      message: error.message,
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Met dev proxy listening on http://localhost:${PORT}`);
  console.log(`  API:    http://localhost:${PORT}/met-api/public/collection/v1/...`);
  console.log(`  Images: http://localhost:${PORT}/met-image?src=...`);
});
