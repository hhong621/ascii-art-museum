// Proxies Met Collection CDN images with CORS headers for the ASCII Art Museum frontend.

const MET_IMAGE_HOST = "images.metmuseum.org";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hhong621.github.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3456",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3456",
  "http://127.0.0.1:5173",
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

function isAllowedMetImageUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === MET_IMAGE_HOST;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const allowedOrigins = getAllowedOrigins(env);
    const cors = corsHeaders(request, allowedOrigins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405, request, allowedOrigins);
    }

    const url = new URL(request.url);
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

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
    headers.set("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"]);
    headers.set("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"]);

    if (cors["Access-Control-Allow-Origin"]) {
      headers.set("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"]);
    }
    if (cors.Vary) {
      headers.set("Vary", cors.Vary);
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
