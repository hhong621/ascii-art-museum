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

Serve the folder over HTTP (ES modules won't load from `file://`):

```bash
npx serve .
```

Then open the URL shown in the terminal.

## Credits

Artwork images and metadata from the [Met Collection API](https://www.metmuseum.org/perspectives/met-collection-api-2). ASCII rendering powered by [textmode.js](https://code.textmode.art/).
