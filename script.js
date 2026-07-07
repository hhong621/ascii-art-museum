// --- Configuration ---
const ARTWORKS_URL = "https://api.artic.edu/api/v1/artworks";
const IIIF_BASE = "https://www.artic.edu/iiif/2";
const IIIF_SIZE = "843,";
const CACHE_KEY = 'aicArtworksCache';
const CACHE_DURATION = 60 * 60 * 1000; // Cache expiration time in milliseconds (1 hour = 60 * 60 * 1000)
const ARTWORK_BATCH_SIZE = 10;
const MIN_BATCH_WITH_IMAGES = 5;
const MAX_BATCH_FETCH_ATTEMPTS = 20;
const ARTWORK_FIELDS = 'id,title,image_id,artist_display,date_display';
const AIC_HEADERS = {
    'AIC-User-Agent': 'ascii-art-museum (https://hhong621.github.io/ARTIC-ASCII/)',
};
let currentIndex = 0;
let isRevealed = false;
const artworkText = document.getElementById('artwork-text');
const artworkImage = document.getElementById('image');
const canvas = document.getElementById('textmode-canvas');
const overlay = document.getElementById('overlay');
const imageContainer = document.getElementById('image-container');
const artworkContainer = document.getElementById('artwork-container');
const controls = document.getElementById('controls');

/**
 * @returns {Promise<number>}
 */
async function getArtworkIdUpperBound() {
    const countResponse = await fetch(`${ARTWORKS_URL}?limit=0`, { headers: AIC_HEADERS });
    if (!countResponse.ok) {
        throw new Error(`HTTP error! status: ${countResponse.status}`);
    }

    const countData = await countResponse.json();
    const totalArtworks = countData.pagination.total;
    if (totalArtworks === 0) {
        throw new Error('No artworks found.');
    }

    return totalArtworks;
}

/**
 * @param {number} count
 * @param {number} upperBound
 * @param {Set<number>} seenIds
 * @returns {number[]}
 */
function pickRandomArtworkIds(count, upperBound, seenIds) {
    const ids = [];
    const maxTries = count * 10;

    for (let tries = 0; ids.length < count && tries < maxTries; tries++) {
        const id = Math.floor(Math.random() * upperBound) + 1;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        ids.push(id);
    }

    return ids;
}

/**
 * @param {number[]} ids
 * @returns {Promise<Array<Object>>}
 */
async function fetchArtworksByIds(ids) {
    if (ids.length === 0) return [];

    const response = await fetch(
        `${ARTWORKS_URL}?ids=${ids.join(',')}&fields=${ARTWORK_FIELDS}`,
        { headers: AIC_HEADERS },
    );
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const apiResponse = await response.json();
    return apiResponse.data ?? [];
}

/**
 * Fetch a random batch of artworks that have images.
 * @returns {Promise<Array<Object>>}
 */
async function fetchArtworksFromApi() {
    const upperBound = await getArtworkIdUpperBound();
    const seenIds = new Set();
    const artworks = [];
    const artworkIds = new Set();

    for (let attempt = 0; attempt < MAX_BATCH_FETCH_ATTEMPTS; attempt++) {
        if (artworks.length >= ARTWORK_BATCH_SIZE) break;

        const ids = pickRandomArtworkIds(ARTWORK_BATCH_SIZE, upperBound, seenIds);
        if (ids.length === 0) break;

        const batch = await fetchArtworksByIds(ids);
        for (const artwork of batch) {
            if (artworks.length >= ARTWORK_BATCH_SIZE) break;
            if (!artwork.image_id || artworkIds.has(artwork.id)) continue;
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
    const cachedData = localStorage.getItem(CACHE_KEY);

    if (cachedData) {
        try {
            const cache = JSON.parse(cachedData);
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

    // Fetch data from the AIC API (Network call)
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
        return null;
    }
}

// --- Implementation and Rendering ---
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 600;
const t = textmode.create({canvas, width: CANVAS_WIDTH, height: CANVAS_HEIGHT});

function syncCanvasSize() {
    t.resizeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawArtworkImage() {
    if (!myImage) return;
    t.image(myImage, myImage.width, myImage.height);
}

let myImage;
let characters = " .:-=+*#%@";
let imageUrl;
let sourceCanvas;
let sourceCtx;

const trail = [];
const MAX_TRAIL = 250;
const MAX_SPAWN_PER_MOVE = 4;
let lastMouse = null;

function buildImageUrl(imageId) {
    return `${IIIF_BASE}/${imageId}/full/${IIIF_SIZE}/0/default.jpg`;
}

function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

async function applyArtworkImage(url) {
    await preloadImage(url);
    imageUrl = url;
    artworkImage.src = url;
    if (!isRevealed) {
        overlay.style.display = 'flex';
    }
    await loadArtworkImage(url);
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

    if (!artwork.image_id) {
        currentIndex = (currentIndex + 1) % artworkData.length;
        return renderArtworkData(skipAttempts + 1);
    }

    try {
        await applyArtworkImage(buildImageUrl(artwork.image_id));
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
    charColor: '#ffffff',
    cellColor: '#000000',
    charColorMode: "sampled",
    cellColorMode: "fixed",
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

async function loadSourcePixels(url) {
    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.referrerPolicy = "no-referrer";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { canvas, ctx };
}

function isInsideImageGrid(gridX, gridY) {
    if (!myImage) return false;

    const width = myImage.width;
    const height = myImage.height;
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

    const width = myImage.width;
    const height = myImage.height;
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

async function loadArtworkImage(url) {
    if (!url) return;

    trail.length = 0;
    lastMouse = null;

    try {
        syncCanvasSize();
        const [image, pixels] = await Promise.all([
            t.loadImage(url),
            loadSourcePixels(url),
        ]);
        myImage = image;
        sourceCanvas = pixels.canvas;
        sourceCtx = pixels.ctx;
        configureImage(myImage);
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                syncCanvasSize();
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
    syncCanvasSize();
});

document.fonts.ready.then(() => {
    syncCanvasSize();
});

t.setup(() => {
    renderArtworkData();
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
    if (currentIndex < (artworkData.length - 1)) {
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
