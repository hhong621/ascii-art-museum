import express from "express";
import {
  buildUpstreamErrorPayload,
  fetchUpstreamImage,
} from "./upstream.js";

const PORT = process.env.PORT || 3001;
const IIIF_BASE = "https://www.artic.edu/iiif/2";
const IMAGE_SIZE = "843,";
const IMAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hhong621.github.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
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
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
}

function buildIiifUrl(imageId) {
  return `${IIIF_BASE}/${imageId}/full/${IMAGE_SIZE}/0/default.jpg`;
}

const app = express();
app.use(cors);

app.get("/image", async (req, res) => {
  const imageId = req.query.id;

  if (!imageId) {
    return res.status(400).json({ error: "Missing required query parameter: id" });
  }

  if (!IMAGE_ID_PATTERN.test(imageId)) {
    return res.status(400).json({ error: "Invalid image id" });
  }

  const upstreamUrl = buildIiifUrl(imageId);
  const upstream = await fetchUpstreamImage(upstreamUrl);

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    return res.status(status).json(buildUpstreamErrorPayload(upstream));
  }

  res.setHeader("Content-Type", upstream.contentType || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
  res.send(upstream.body);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`ARTIC-ASCII image proxy listening on http://localhost:${PORT}`);
});
