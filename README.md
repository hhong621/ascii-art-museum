# ASCII Art Museum

A browser-based gallery that renders artworks from the [Art Institute of Chicago](https://www.artic.edu/) as live ASCII art. Each session pulls a small random batch from the [AIC API](https://api.artic.edu/docs/#introduction), cached in `localStorage` for one hour.

**[Live demo](https://hhong621.github.io/ARTIC-ASCII/)**

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

Artwork images and metadata from the [Art Institute of Chicago API](https://api.artic.edu/docs/#introduction). ASCII rendering powered by [textmode.js](https://code.textmode.art/).
