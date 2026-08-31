# ASCII Art Museum

A browser-based gallery that renders artworks from the [Metropolitan Museum of Art](https://www.metmuseum.org/) as live ASCII art. Each session pulls a small random batch from the [Met Collection API](https://www.metmuseum.org/perspectives/met-collection-api-2), cached in `localStorage` for one hour.

**[Live demo](https://hhong621.github.io/ascii-art-museum/)**

> This repository now redirects to [ascii-art-museum](https://hhong621.github.io/ascii-art-museum/). The live site is maintained in the [ascii-art-museum](https://github.com/hhong621/ascii-art-museum) repo.

## Features

- **ASCII rendering** — Images are drawn on a WebGL canvas via [textmode.js](https://code.textmode.art/), with adjustable character and cell colors (sampled from the image or fixed).
- **Artwork details** — Title, artist, and date sit alongside the piece; click to reveal the original image.
- **Browse the batch** — Step through the cached artworks with **Next Artwork**.
- **Interactive canvas** — Moving the mouse over the piece leaves a fading binary trail.

## Run locally

Live Server / static hosting is not enough on its own. Met blocks many direct browser requests from `localhost`, so run the dev proxy too:

```bash
# terminal 1
npx serve .

# terminal 2
cd proxy && npm install && npm run dev
```

## Production CORS proxy

GitHub Pages is static, so the live site uses a Cloudflare Worker to proxy Met API + image requests with CORS headers.

Deploy once (requires a free Cloudflare account):

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints a `*.workers.dev` URL. Put that URL in `index.html`:

```html
<meta name="met-proxy" content="https://your-worker-url.workers.dev">
```

Push to GitHub and the deployed site will auto-detect the proxy on load.

## Credits

Artwork images and metadata from the [Met Collection API](https://www.metmuseum.org/perspectives/met-collection-api-2). ASCII rendering powered by [textmode.js](https://code.textmode.art/).
