// --- Configuration ---
const MET_API_DIRECT = "https://collectionapi.metmuseum.org/public/collection/v1";
const CACHE_KEY = 'metArtworksCacheV4';
const MET_IMAGE_HOST = 'images.metmuseum.org';
const MAX_ASCII_IMAGE_DIM = 1200;
const API_FETCH_CONCURRENCY = 3;
const API_FETCH_CONCURRENCY_DIRECT = 1;
const API_REQUEST_DELAY_MS = 300;
const IMAGE_LOAD_RETRY_DELAY_MS = 400;
const LOCAL_PROXY_CANDIDATES = [
    'http://127.0.0.1:3001',
    'http://localhost:3001',
];
const PRODUCTION_PROXY_CANDIDATES = [
    'https://ascii-art-museum-met.8hong16.workers.dev',
];
const CACHE_DURATION = 60 * 60 * 1000; // Cache expiration time in milliseconds (1 hour = 60 * 60 * 1000)
const ARTWORK_BATCH_SIZE = 10;
const MIN_BATCH_WITH_IMAGES = 5;
const MAX_BATCH_FETCH_ATTEMPTS = 20;
const SEARCH_POOL_SIZE = 1000;
let currentIndex = 0;
let isRevealed = false;
const artworkText = document.getElementById('artwork-text');
const artworkImage = document.getElementById('image');
const canvas = document.getElementById('textmode-canvas');
const overlay = document.getElementById('overlay');
const imageContainer = document.getElementById('image-container');
const artworkContainer = document.getElementById('artwork-container');
const controls = document.getElementById('controls');

let metApiBase = MET_API_DIRECT;
let metProxyBase = null;
let proxyProbeDone = false;

function getProductionProxyCandidates() {
    const meta = document.querySelector('meta[name="met-proxy"]')?.content?.trim();
    if (meta) {
        return [meta.replace(/\/$/, '')];
    }
    return PRODUCTION_PROXY_CANDIDATES;
}

function isProductionHost() {
    return window.location.hostname === 'hhong621.github.io';
}

function isLocalDevHost() {
    const { hostname } = window.location;
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

async function probeProxy(base) {
    try {
        const response = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(3000),
        });
        return response.ok ? base : null;
    } catch {
        return null;
    }
}

function configureMetProxy(base) {
    metProxyBase = base;
    metApiBase = `${base}/met-api/public/collection/v1`;
    console.log(`Using Met proxy at ${base}`);
}

async function resolveMetProxy() {
    if (proxyProbeDone) return metProxyBase;
    proxyProbeDone = true;

    const params = new URLSearchParams(window.location.search);
    if (params.has('imageProxy')) {
        const override = params.get('imageProxy');
        if (override) {
            configureMetProxy(override.replace(/\/$/, ''));
        }
        return metProxyBase;
    }

    const candidates = isLocalDevHost()
        ? LOCAL_PROXY_CANDIDATES
        : isProductionHost()
            ? getProductionProxyCandidates()
            : [];

    for (const base of candidates) {
        const resolved = await probeProxy(base);
        if (resolved) {
            configureMetProxy(resolved);
            return metProxyBase;
        }
    }

    if (isLocalDevHost()) {
        console.warn(
            'Local Met proxy not detected. Start it with: cd proxy && npm install && npm run dev',
        );
        showDevProxyNotice();
    } else if (isProductionHost()) {
        console.warn(
            'Production Met proxy unavailable. Deploy with: cd worker && npx wrangler deploy',
        );
    }

    return null;
}

function showDevProxyNotice() {
    if (document.getElementById('dev-proxy-notice')) return;

    const notice = document.createElement('div');
    notice.id = 'dev-proxy-notice';
    notice.innerHTML =
        'Local dev needs the Met proxy. Run <code>cd proxy && npm install && npm run dev</code>, then refresh.';
    notice.style.cssText = [
        'position: fixed',
        'bottom: 1rem',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 1000',
        'max-width: 34rem',
        'padding: 0.75rem 1rem',
        'border-radius: 0.5rem',
        'background: #1a1a1a',
        'color: #d6f50c',
        'font-family: "JetBrains Mono", monospace',
        'font-size: 0.8rem',
        'line-height: 1.4',
        'box-shadow: 0 8px 24px rgba(0,0,0,0.35)',
    ].join(';');
    document.body.appendChild(notice);
}

function getApiFetchConcurrency() {
    return metProxyBase ? API_FETCH_CONCURRENCY : API_FETCH_CONCURRENCY_DIRECT;
}

function isProxiedImageUrl(url) {
    return url.includes('/met-image?src=');
}

function getMetSearchApiBase() {
    return metApiBase.replace('/collection/v1', '/collection/v1.1');
}

/**
 * @param {Record<string, string>} params
 * @returns {Promise<{ total: number, objectIDs: number[] }>}
 */
async function fetchMetSearch(params) {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${getMetSearchApiBase()}/search?${query}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
        total: data.total ?? 0,
        objectIDs: data.objectIDs ?? [],
    };
}

/**
 * @returns {Promise<number[]>}
 */
async function searchArtworkIds() {
    const probe = await fetchMetSearch({
        hasImages: 'true',
        q: 'painting',
        limit: '1',
    });
    if (!probe.total || probe.objectIDs.length === 0) {
        throw new Error('No artworks found.');
    }

    const poolSize = Math.min(SEARCH_POOL_SIZE, probe.total);
    const pageSize = 500;
    const ids = [];
    const pagesNeeded = Math.ceil(poolSize / pageSize);

    for (let page = 0; page < pagesNeeded && ids.length < poolSize; page++) {
        const limit = Math.min(pageSize, poolSize - ids.length);
        const maxOffset = Math.max(0, probe.total - limit);
        const offset = Math.floor(Math.random() * (maxOffset + 1));
        const { objectIDs } = await fetchMetSearch({
            hasImages: 'true',
            q: 'painting',
            limit: String(limit),
            offset: String(offset),
        });

        for (const id of objectIDs) {
            if (!ids.includes(id)) ids.push(id);
            if (ids.length >= poolSize) break;
        }
    }

    if (ids.length === 0) {
        throw new Error('No artworks found.');
    }

    return ids;
}

/**
 * @param {number[]} pool
 * @param {number} count
 * @param {Set<number>} seenIds
 * @returns {number[]}
 */
function pickRandomIds(pool, count, seenIds) {
    const ids = [];
    const maxTries = count * 10;

    for (let tries = 0; ids.length < count && tries < maxTries; tries++) {
        const id = pool[Math.floor(Math.random() * pool.length)];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        ids.push(id);
    }

    return ids;
}

function isMetCdnUrl(url) {
    try {
        return new URL(url).hostname === MET_IMAGE_HOST;
    } catch {
        return false;
    }
}

function getImageProxyBase() {
    if (metProxyBase) return metProxyBase;

    const params = new URLSearchParams(window.location.search);
    if (!params.has('imageProxy')) return null;

    const override = params.get('imageProxy');
    return override ? override.replace(/\/$/, '') : null;
}

function proxiedImageUrl(url, proxyBase) {
    return `${proxyBase.replace(/\/$/, '')}/met-image?src=${encodeURIComponent(url)}`;
}

function canvasImageCandidates(url) {
    const candidates = [url];
    const proxyBase = getImageProxyBase();
    if (proxyBase) {
        candidates.push(proxiedImageUrl(url, proxyBase));
    }
    return [...new Set(candidates)];
}

function artworkImageCandidates(artwork) {
    const urls = artwork.image_urls?.length
        ? artwork.image_urls
        : [artwork.image_url].filter(Boolean);

    if (metProxyBase) {
        return [...new Set(urls.map((url) => proxiedImageUrl(url, metProxyBase)))];
    }

    return [...new Set(urls.flatMap(canvasImageCandidates))];
}

async function loadImageElement(url) {
    if (isProxiedImageUrl(url)) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Image failed: ${url}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        try {
            return await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Image failed: ${url}`));
                img.src = objectUrl;
            });
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    return preloadImage(url);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Array<unknown>} items
 * @param {number} limit
 * @param {(item: unknown, index: number) => Promise<unknown>} fn
 * @returns {Promise<Array<unknown>>}
 */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await fn(items[index], index);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
    return results;
}

function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Image failed: ${url}`));
        img.src = url;
    });
}

async function loadCanvasImage(urls) {
    let lastError;

    for (let i = 0; i < urls.length; i++) {
        if (i > 0) {
            await delay(IMAGE_LOAD_RETRY_DELAY_MS);
        }

        try {
            return await loadImageElement(urls[i]);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error('No image URLs to load');
}

/**
 * Prefer the smaller Met CDN asset; avoid probing images during batch fetch
 * (parallel crossOrigin loads trigger Met CDN rate limits and CORS failures).
 * @param {Object} obj
 * @returns {string | null}
 */
function pickImageUrls(obj) {
    return [obj.primaryImageSmall, obj.primaryImage].filter(
        (url) => url && isMetCdnUrl(url),
    );
}

/**
 * @param {number} id
 * @returns {Promise<Object | null>}
 */
async function fetchArtworkById(id) {
    if (!metProxyBase) {
        await delay(API_REQUEST_DELAY_MS);
    }

    const response = await fetch(`${metApiBase}/objects/${id}`);
    if (!response.ok) return null;

    const obj = await response.json();
    const image_urls = pickImageUrls(obj);
    if (image_urls.length === 0) return null;

    return {
        id: obj.objectID,
        title: obj.title || 'Untitled',
        artist_display: obj.artistDisplayName || 'N/A',
        date_display: obj.objectDate || 'N/A',
        image_url: image_urls[0],
        image_urls,
    };
}

/**
 * Fetch a random batch of artworks that have images.
 * @returns {Promise<Array<Object>>}
 */
async function fetchArtworksFromApi() {
    const pool = await searchArtworkIds();
    const seenIds = new Set();
    const artworks = [];
    const artworkIds = new Set();

    for (let attempt = 0; attempt < MAX_BATCH_FETCH_ATTEMPTS; attempt++) {
        if (artworks.length >= ARTWORK_BATCH_SIZE) break;

        const ids = pickRandomIds(pool, ARTWORK_BATCH_SIZE * 2, seenIds);
        if (ids.length === 0) break;

        const batch = await mapWithConcurrency(
            ids,
            getApiFetchConcurrency(),
            fetchArtworkById,
        );
        for (const artwork of batch) {
            if (artworks.length >= ARTWORK_BATCH_SIZE) break;
            if (!artwork || artworkIds.has(artwork.id)) continue;
            artworkIds.add(artwork.id);
            artworks.push(artwork);
        }
    }

    if (artworks.length < MIN_BATCH_WITH_IMAGES) {
        throw new Error(
            `Could only find ${artworks.length} artworks with images (minimum ${MIN_BATCH_WITH_IMAGES}).`,
        );
    }

    return artworks;
}

/**
 * Fetches artwork data, checking the cache first.
 * @returns {Promise<Array<Object> | null>} The array of artworks or null on error.
 */
async function fetchArtworksAndCache() {
    let staleCache = null;
    const cachedData = localStorage.getItem(CACHE_KEY);

    if (cachedData) {
        try {
            const cache = JSON.parse(cachedData);
            staleCache = cache.data;
            const now = new Date().getTime();

            // Check for cache hit and freshness
            if (now - cache.timestamp < CACHE_DURATION) {
                console.log('Data retrieved from CACHE. (Timestamp: ' + new Date(cache.timestamp).toLocaleTimeString() + ')');
                // Return the data array directly
                return cache.data;
            } else {
                console.log('Cached data found but has EXPIRED. Fetching new data...');
                // Proceed to fetch new data
            }
        } catch (e) {
            console.error('Error parsing cached data. Fetching new data.', e);
            // If parsing fails, proceed to fetch new data
        }
    } else {
        console.log('No cached data found. Fetching from API...');
        // Proceed to fetch new data
    }

    // Fetch data from the Met API (Network call)
    try {
        const artworks = await fetchArtworksFromApi();
        if (artworks.length < MIN_BATCH_WITH_IMAGES) {
            throw new Error(`Fewer than ${MIN_BATCH_WITH_IMAGES} artworks with images in this batch.`);
        }

        // Update the cache with the new data and a fresh timestamp
        const cachePayload = {
            timestamp: new Date().getTime(),
            data: artworks
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));

        console.log('Successfully fetched data from API and updated the CACHE. (Timestamp: ' + new Date(cachePayload.timestamp).toLocaleTimeString() + ')');
        return artworks;

    } catch (error) {
        console.error('An error occurred during API fetch:', error);
        if (staleCache?.length) {
            console.warn('Using stale cache after API fetch failed.');
            return staleCache;
        }
        return null;
    }
}

// --- Implementation and Rendering ---
const DEFAULT_RESOLUTION = 800;
const MIN_RESOLUTION = 200;
const MAX_RESOLUTION = 1000;
const t = textmode.create({
    canvas,
    width: DEFAULT_RESOLUTION,
    height: DEFAULT_RESOLUTION,
});

function syncResolution() {
    const resolution = PARAMS?.resolution ?? DEFAULT_RESOLUTION;
    t.resizeCanvas(resolution, resolution);
}

function drawArtworkImage() {
    if (!myImage || !imageDisplayWidth || !imageDisplayHeight) return;
    // Fixed footprint in grid cells; texture resolution (Detail) is stretched with nearest filtering.
    t.image(myImage, imageDisplayWidth, imageDisplayHeight);
}

let myImage;
let characters = " .:-=+*#%@";
let imageUrl;
let sourceCanvas;
let sourceCtx;
let currentSourceImage = null;
let imageDisplayWidth = 0;
let imageDisplayHeight = 0;
let rebuildAsciiFrame = 0;

const trail = [];
const MAX_TRAIL = 250;
const MAX_SPAWN_PER_MOVE = 4;
let lastMouse = null;

function fitSourcePixelsToGrid(sourceW, sourceH, gridCols, gridRows) {
    const scale = Math.min(gridCols / sourceW, gridRows / sourceH);
    return {
        width: Math.max(1, Math.floor(sourceW * scale)),
        height: Math.max(1, Math.floor(sourceH * scale)),
    };
}

function getAsciiGridDimensions() {
    const cols = t.grid?.cols;
    const rows = t.grid?.rows;
    if (cols && rows) {
        return { cols, rows };
    }
    return { cols: PARAMS.resolution, rows: PARAMS.resolution };
}

function computeImageDisplayCells(img) {
    const downscale = Math.min(
        1,
        MAX_ASCII_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const sourceW = Math.max(1, Math.round(img.naturalWidth * downscale));
    const sourceH = Math.max(1, Math.round(img.naturalHeight * downscale));
    const { cols, rows } = getAsciiGridDimensions();
    // Match textmode createTexture: draw size fits the grid, not raw source pixels.
    return fitSourcePixelsToGrid(sourceW, sourceH, cols, rows);
}

function syncImageDisplayFromTexture() {
    if (!myImage) return;
    imageDisplayWidth = myImage.width;
    imageDisplayHeight = myImage.height;
}

function buildAsciiSourceCanvas(img) {
    const maxDim = Math.min(PARAMS.sourceMaxDim, MAX_ASCII_IMAGE_DIM);
    const sampleScale = Math.min(
        1,
        maxDim / Math.max(img.naturalWidth, img.naturalHeight),
    );
    let sampleW = Math.max(1, Math.round(img.naturalWidth * sampleScale));
    let sampleH = Math.max(1, Math.round(img.naturalHeight * sampleScale));

    if (imageDisplayWidth && imageDisplayHeight) {
        const detailRatio = maxDim / MAX_ASCII_IMAGE_DIM;
        const capW = Math.max(1, Math.round(imageDisplayWidth * detailRatio));
        const capH = Math.max(1, Math.round(imageDisplayHeight * detailRatio));
        const capScale = Math.min(capW / sampleW, capH / sampleH, 1);
        sampleW = Math.max(1, Math.round(sampleW * capScale));
        sampleH = Math.max(1, Math.round(sampleH * capScale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, sampleW, sampleH);
    ctx.getImageData(0, 0, 1, 1);
    return { canvas, ctx };
}

async function applyArtworkImage(artwork) {
    const displayUrl = artwork.image_url || artwork.image_urls?.[0];
    const img = await loadCanvasImage(artworkImageCandidates(artwork));
    imageUrl = displayUrl;
    artworkImage.removeAttribute('crossorigin');
    artworkImage.src = displayUrl;
    if (!isRevealed) {
        overlay.style.display = 'flex';
    }
    await loadArtworkImage(img);
}

/**
 * Display the data and image of the current artwork
 * @param {number} skipAttempts - how many artworks have been skipped this render pass
 */
async function renderArtworkData(skipAttempts = 0) {
    const title = document.getElementById("artwork-title");
    const artist = document.getElementById("artwork-artist");
    const date = document.getElementById("artwork-date");
    const artworkData = await fetchArtworksAndCache();

    if (!artworkData) {
        title.innerHTML = "Could not retrieve artwork data due to an error. Check console for details.";
        return;
    }

    if (artworkData.length === 0) {
        title.innerHTML = "No artworks were found with the current query.";
        return;
    }

    if (skipAttempts >= artworkData.length) {
        title.innerHTML = "Could not load any artwork images. Try again later.";
        artist.innerHTML = "";
        date.innerHTML = "";
        return;
    }

    const artwork = artworkData[currentIndex];
    title.innerHTML = artwork.title;
    artist.innerHTML = artwork.artist_display || 'N/A';
    date.innerHTML = artwork.date_display || 'N/A';

    if (!artwork.image_url && !artwork.image_urls?.length) {
        currentIndex = (currentIndex + 1) % artworkData.length;
        return renderArtworkData(skipAttempts + 1);
    }

    try {
        await applyArtworkImage(artwork);
    } catch (error) {
        console.error('Failed to load artwork image:', error);
        currentIndex = (currentIndex + 1) % artworkData.length;
        return renderArtworkData(skipAttempts + 1);
    }
}

// Handle WebGL context loss and restoration
t.canvas.addEventListener("webglcontextlost", handleContextLost, false);
t.canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

/**
 * Stop rendering if WebGL context is lost
 * @param event
 */
function handleContextLost(event) {
    // Prevent the default handling to allow context restoration
    event.preventDefault();
    console.warn("WebGL context lost - stopping render loop");
    t.noLoop();
}

/**
 * Reload window when context is restored
 */
function handleContextRestored() {
    window.location.reload();
    console.log("WebGL context restored - resuming render loop");
}

/**
 * Tweakpane implementation
 */

import {Pane} from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.4/+esm';

// Setup pane and params
const pane = new Pane({
    container: controls,
});

const PARAMS = {
    resolution: DEFAULT_RESOLUTION,
    charColor: '#ffffff',
    cellColor: '#000000',
    charColorMode: "sampled",
    cellColorMode: "fixed",
    sourceMaxDim: MAX_ASCII_IMAGE_DIM,
};

// Setup folders and bindings
const settingsFolder = pane.addFolder({
    title: 'Settings',
    expanded: true,
});

const actionsFolder = pane.addFolder({
    title: 'Actions',
    expanded: true,
});

const resolutionBinding = settingsFolder.addBinding(PARAMS, 'resolution', {
    label: 'Density',
    min: MIN_RESOLUTION,
    max: MAX_RESOLUTION,
    step: 10,
});

const sourceMaxDimBinding = settingsFolder.addBinding(PARAMS, 'sourceMaxDim', {
    label: 'Sharpness',
    min: 200,
    max: MAX_ASCII_IMAGE_DIM,
    step: 50,
});

const charColorModeBinding = settingsFolder.addBinding(PARAMS, 'charColorMode', {
    view: 'list',
    label: 'Char Color Mode',
    options: [
        {text: 'Sampled', value: 'sampled'},
        {text: 'Fixed', value: 'fixed'},
    ],
    value: 'sampled',
});

const charColorBinding = settingsFolder.addBinding(PARAMS, 'charColor', {
    label: 'Char Color',
});

const cellColorModeBinding = settingsFolder.addBinding(PARAMS, 'cellColorMode', {
    view: 'list',
    label: 'Cell Color Mode',
    options: [
        {text: 'Sampled', value: 'sampled'},
        {text: 'Fixed', value: 'fixed'},
    ],
    value: 'fixed',
});

const cellColorBinding = settingsFolder.addBinding(PARAMS, 'cellColor', {
    label: 'Cell Color',
});

function hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map((c) => c + c).join('')
        : normalized;
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

function isInsideImageGrid(gridX, gridY) {
    if (!myImage || !imageDisplayWidth || !imageDisplayHeight) return false;

    const width = imageDisplayWidth;
    const height = imageDisplayHeight;
    const localX = gridX + Math.floor(width / 2);
    const localY = gridY + Math.floor(height / 2);

    return localX >= 0 && localY >= 0 && localX < width && localY < height;
}

function sampleImageColors(gridX, gridY) {
    const fixedChar = hexToRgb(PARAMS.charColor);
    const fixedCell = hexToRgb(PARAMS.cellColor);

    if (!myImage || !sourceCtx || !isInsideImageGrid(gridX, gridY)) {
        return { char: fixedChar, cell: fixedCell };
    }

    const width = imageDisplayWidth;
    const height = imageDisplayHeight;
    const localX = gridX + Math.floor(width / 2);
    const localY = gridY + Math.floor(height / 2);

    const u = (localX + 0.5) / width;
    const v = 1 - (localY + 0.5) / height;
    const px = Math.min(sourceCanvas.width - 1, Math.floor(u * sourceCanvas.width));
    const py = Math.min(sourceCanvas.height - 1, Math.floor(v * sourceCanvas.height));
    const [r, g, b] = sourceCtx.getImageData(px, py, 1, 1).data;
    const sampled = [r, g, b];

    return {
        char: PARAMS.charColorMode === "sampled" ? sampled : fixedChar,
        cell: PARAMS.cellColorMode === "sampled" ? sampled : fixedCell,
    };
}

function configureImage(image) {
    image.characters(characters);
    image.charColorMode(PARAMS.charColorMode);
    image.cellColorMode(PARAMS.cellColorMode);
    image.charColor(PARAMS.charColor);
    image.cellColor(PARAMS.cellColor);
}

function disposeMyImage() {
    if (myImage?.dispose) {
        myImage.dispose();
    }
}

function rebuildAsciiTexture({ resetTrail = false } = {}) {
    if (!currentSourceImage) {
        return;
    }

    if (resetTrail) {
        trail.length = 0;
        lastMouse = null;
    }

    try {
        syncResolution();
        const display = computeImageDisplayCells(currentSourceImage);
        imageDisplayWidth = display.width;
        imageDisplayHeight = display.height;
        const pixels = buildAsciiSourceCanvas(currentSourceImage);
        sourceCanvas = pixels.canvas;
        sourceCtx = pixels.ctx;
        disposeMyImage();
        myImage = t.createTexture(pixels.canvas);
        configureImage(myImage);
        syncImageDisplayFromTexture();
    } catch (error) {
        console.error("Failed to rebuild ASCII texture:", error);
        throw error;
    }
}

function scheduleRebuildAsciiTexture() {
    if (rebuildAsciiFrame) {
        cancelAnimationFrame(rebuildAsciiFrame);
    }
    rebuildAsciiFrame = requestAnimationFrame(() => {
        rebuildAsciiFrame = 0;
        rebuildAsciiTexture();
    });
}

async function loadArtworkImage(img) {
    if (!img) return;

    currentSourceImage = img;

    try {
        rebuildAsciiTexture({ resetTrail: true });
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                syncResolution();
                resolve();
            });
        });
    } catch (error) {
        console.error("Failed to load image:", error);
        throw error;
    }
}

t.draw(() => {
    t.background(0);

    drawArtworkImage();

    const trailChars = ["0", "1", "0", "1"];

    for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        p.age++;

        if (p.age >= p.maxAge) {
            trail.splice(i, 1);
            continue;
        }

        if (!isInsideImageGrid(p.x, p.y)) {
            continue;
        }

        const life = 1 - p.age / p.maxAge;
        const idx = Math.floor(life * trailChars.length);
        const colors = sampleImageColors(p.x, p.y);
        const charColor = colors.char.map((c) => Math.round(c * life));
        const cellColor = colors.cell.map((c) => Math.round(c * life));

        t.push();
        t.cellColor(cellColor[0], cellColor[1], cellColor[2]);
        t.charColor(charColor[0], charColor[1], charColor[2]);
        t.translate(p.x, p.y);
        t.char(trailChars[Math.min(idx, trailChars.length - 1)]);
        t.point();
        t.pop();
    }
});

t.mouseMoved((data) => {
    const { x, y } = data.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (!isInsideImageGrid(x, y)) {
        lastMouse = { x, y };
        return;
    }

    const dx = lastMouse ? x - lastMouse.x : 0;
    const dy = lastMouse ? y - lastMouse.y : 0;
    const speed = Math.sqrt(dx * dx + dy * dy);
    const count = Math.min(MAX_SPAWN_PER_MOVE, Math.max(1, Math.ceil(speed * 1.5)));

    for (let i = 0; i < count && trail.length < MAX_TRAIL; i++) {
        trail.push({
            x,
            y,
            age: 0,
            maxAge: 15 + Math.random() * 10,
        });
    }

    lastMouse = { x, y };
});

t.windowResized(() => {
    syncResolution();
});

document.fonts.ready.then(() => {
    syncResolution();
});

t.setup(async () => {
    await resolveMetProxy();
    renderArtworkData();
});

resolutionBinding.on('change', () => {
    if (currentSourceImage) {
        scheduleRebuildAsciiTexture();
    } else {
        syncResolution();
    }
});

sourceMaxDimBinding.on('change', () => {
    scheduleRebuildAsciiTexture();
});

// Event listener for charColorMode, charColorBinding input is hidden when set to "sampled"
charColorModeBinding.on('change', (event) => {
    const isHidden = event.value === 'sampled';
    charColorBinding.hidden = isHidden;
    PARAMS.charColorMode = event.value;
    if (myImage) configureImage(myImage);
});

// Initial state for charColorBinding input
charColorBinding.hidden = true;

// Event listener for charColorBinding
charColorBinding.on('change', () => {
    if (myImage) configureImage(myImage);
});

// Event listener for cellColorMode, cellColorBinding input is hidden when set to "sampled"
cellColorModeBinding.on('change', (event) => {
    const isHidden = event.value === 'sampled';
    cellColorBinding.hidden = isHidden;
    PARAMS.cellColorMode = event.value;
    if (myImage) configureImage(myImage);
});

// Event listener for cellColorBinding
cellColorBinding.on('change', () => {
    if (myImage) configureImage(myImage);
});

// Setup show artwork button (mobile only)
const showArtworkBtn = actionsFolder.addButton({
    title: 'View Artwork Info',
});

// Match media check
const mobileScreenMatch = window.matchMedia('(max-width: 1024px)');
 
mobileScreenMatch.addEventListener('change', screenCheck); // Onchange listener
screenCheck(); // Initial call

/**
 * Checks screen size to update show artwork button visibility
 */
function screenCheck() {
    if (mobileScreenMatch.matches) {
        showArtworkBtn.hidden = false;
    }
    else {
        showArtworkBtn.hidden = true;
    }
}

// Event listener for show artwork button click, opens sheet
showArtworkBtn.on('click', () => {
    artworkContainer.style.display = "block";
    document.body.classList.add("modal-open");
});

// Setup next button
const nextBtn = actionsFolder.addButton({
    title: 'Next Artwork',
});

// Event listener for next button click, advance index, reset revealed state, and rerender
nextBtn.on('click', async () => {
    const artworkData = await fetchArtworksAndCache();
    if (!artworkData?.length) return;

    if (currentIndex < artworkData.length - 1) {
        currentIndex++;
    } else {
        currentIndex = 0;
    }
    setIsRevealed(false);
    renderArtworkData();
});

// Setup reset button
const resetBtn = actionsFolder.addButton({
    title: 'Reset Colors',
});

// Event listener for reset colors button
resetBtn.on('click', () => {
    PARAMS.charColorMode = "sampled";
    PARAMS.charColor = "#ffffff";
    PARAMS.cellColorMode = "fixed";
    PARAMS.cellColor = "#000000";
    if (myImage) configureImage(myImage);
    pane.refresh();
});

/**
 * Set CSS for imageContainer and artworkText 
 * @param revealed boolean for if artwork data is revealed
 */
function setIsRevealed(revealed) {
    isRevealed = revealed;
    if (revealed) {
        imageContainer.style.top = (artworkText.offsetHeight + 32) + "px";
        artworkText.style.opacity = 1;
        overlay.style.display = 'none';
    } else {
        imageContainer.style.top = 0;
        artworkText.style.opacity = 0;
        overlay.style.display = 'flex';
    }
}

overlay.addEventListener('click', () => {
    setIsRevealed(true);
});

// Mobile event listeners

// Sheet scrim onClick listener, closes sheet
artworkContainer.addEventListener('click', () => {
    artworkContainer.style.display = "none";
    document.body.classList.remove("modal-open");
});

// Close button onClick listener, closes sheet
document.getElementById('sheet-close').addEventListener('click', () => {
    artworkContainer.style.display = "none";
    document.body.classList.remove("modal-open");
});

// Sheet surface onClick listener, prevents surface clicks from closing sheet
document.getElementById('artwork-wrapper').addEventListener('click', (event) => {
    event.stopPropagation();
});
