// Proxies Met Collection API + CDN images with CORS headers for ASCII Art Museum.

const MET_API_ORIGIN = "https://collectionapi.metmuseum.org";
const MET_IMAGE_HOST = "images.metmuseum.org";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hhong621.github.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3456",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://localhost:8787",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3456",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:8787",
];

function getAllowedOrigins(env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

function jsonResponse(body, status, request, allowedOrigins) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request, allowedOrigins),
    },
  });
}

function withCors(upstreamHeaders, cors) {
  const headers = new Headers(upstreamHeaders);
  headers.set("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"]);
  headers.set("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"]);
  if (cors["Access-Control-Allow-Origin"]) {
    headers.set("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"]);
  }
  if (cors.Vary) {
    headers.set("Vary", cors.Vary);
  }
  return headers;
}

function isAllowedMetImageUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === MET_IMAGE_HOST;
  } catch {
    return false;
  }
}

async function proxyMetApi(request, path, query, allowedOrigins) {
  const cors = corsHeaders(request, allowedOrigins);
  const upstreamUrl = `${MET_API_ORIGIN}/public/collection/v1/${path}${query}`;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers: {
      "User-Agent": "ascii-art-museum-proxy (hhong621.github.io)",
      Accept: "application/json",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 300,
    },
  });

  const headers = withCors(upstream.headers, cors);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
  headers.set("Cache-Control", "public, max-age=300");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function proxyMetImage(request, src, allowedOrigins) {
  const cors = corsHeaders(request, allowedOrigins);

  const upstream = await fetch(src, {
    method: request.method,
    headers: {
      "User-Agent": "ascii-art-museum-proxy (hhong621.github.io)",
      Accept: "image/*",
      Referer: "",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 86400,
    },
  });

  const contentType = upstream.headers.get("Content-Type") || "";
  if (!upstream.ok || !contentType.includes("image/")) {
    return jsonResponse(
      { error: "Upstream image unavailable", status: upstream.status },
      upstream.status === 404 ? 404 : 502,
      request,
      allowedOrigins,
    );
  }

  const headers = withCors(upstream.headers, cors);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const allowedOrigins = getAllowedOrigins(env);
    const cors = corsHeaders(request, allowedOrigins);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405, request, allowedOrigins);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true }, 200, request, allowedOrigins);
    }

    if (url.pathname.startsWith("/met-api/public/collection/v1/")) {
      const path = url.pathname.replace("/met-api/public/collection/v1/", "");
      return proxyMetApi(request, path, url.search, allowedOrigins);
    }

    if (url.pathname === "/met-image") {
      const src = url.searchParams.get("src");
      if (!src) {
        return jsonResponse(
          { error: "Missing required query parameter: src" },
          400,
          request,
          allowedOrigins,
        );
      }
      if (!isAllowedMetImageUrl(src)) {
        return jsonResponse({ error: "Invalid Met image URL" }, 400, request, allowedOrigins);
      }
      return proxyMetImage(request, src, allowedOrigins);
    }

    return jsonResponse({ error: "Not found" }, 404, request, allowedOrigins);
  },
};
