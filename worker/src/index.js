// Proxies AIC IIIF images with CORS headers for the ASCII Art Museum frontend.
//
// NOTE: artic.edu blocks Cloudflare Worker subrequests (CF-Worker header / error 1106).
// This worker will return 403 from upstream when deployed on workers.dev.
// The live site loads images directly from artic.edu with referrerPolicy: no-referrer instead.

const IIIF_BASE = "https://www.artic.edu/iiif/2";
const IMAGE_SIZE = "843,";
const IMAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hhong621.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1:3000",
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

function buildIiifUrl(imageId) {
  return `${IIIF_BASE}/${imageId}/full/${IMAGE_SIZE}/0/default.jpg`;
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
    const imageId = url.searchParams.get("id");

    if (!imageId) {
      return jsonResponse(
        { error: "Missing required query parameter: id" },
        400,
        request,
        allowedOrigins,
      );
    }

    if (!IMAGE_ID_PATTERN.test(imageId)) {
      return jsonResponse({ error: "Invalid image id" }, 400, request, allowedOrigins);
    }

    const upstreamUrl = buildIiifUrl(imageId);

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        "User-Agent": "ascii-art-museum-proxy (hhong621.github.io)",
        Accept: "image/*",
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 86400,
      },
    });

    if (!upstream.ok) {
      return jsonResponse(
        { error: "Upstream image unavailable", status: upstream.status },
        upstream.status === 404 ? 404 : 502,
        request,
        allowedOrigins,
      );
    }

    const headers = new Headers(upstream.headers);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/jpeg");
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
