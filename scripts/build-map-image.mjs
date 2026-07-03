/**
 * One-time build: stitch CARTO dark_all tiles (z4) into a single image.
 * Run: npm run build:map
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'map');
const OUT_WEBP = path.join(OUT_DIR, 'world-dark-z4.webp');
const OUT_AVIF = path.join(OUT_DIR, 'world-dark-z4.avif');
const WEBP_QUALITY = 62;
const AVIF_QUALITY = 45;

const ZOOM = 4;
const TILE = 256;
const BOUNDS = { south: -58, west: -180, north: 85, east: 180 };
const CARTO_HOSTS = ['a', 'b', 'c', 'd'];
const STYLE = 'dark_all';

function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

function lng2tile(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

function tile2lat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tile2lng(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

function imageBoundsFromTiles(xMin, xMax, yMin, yMax, zoom) {
  return {
    south: tile2lat(yMax + 1, zoom),
    west: tile2lng(xMin, zoom),
    north: tile2lat(yMin, zoom),
    east: tile2lng(xMax + 1, zoom)
  };
}

function tileUrl(x, y) {
  const host = CARTO_HOSTS[(x + y) % CARTO_HOSTS.length];
  return `https://${host}.basemaps.cartocdn.com/${STYLE}/${ZOOM}/${x}/${y}.png`;
}

async function fetchTile(x, y) {
  const res = await fetch(tileUrl(x, y), {
    headers: { 'User-Agent': 'Juliemap-build/1.0' }
  });
  if (!res.ok) throw new Error(`Tile ${x}/${y}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const n = 2 ** ZOOM;
  const xMin = lng2tile(BOUNDS.west, ZOOM);
  const xMax = Math.min(n - 1, lng2tile(BOUNDS.east - 1e-6, ZOOM));
  const yMin = lat2tile(BOUNDS.north, ZOOM);
  const yMax = lat2tile(BOUNDS.south, ZOOM);

  const cols = xMax - xMin + 1;
  const rows = yMax - yMin + 1;
  const width = cols * TILE;
  const height = rows * TILE;
  const geo = imageBoundsFromTiles(xMin, xMax, yMin, yMax, ZOOM);

  console.log(`Stitching ${cols}×${rows} tiles → ${width}×${height}px`);
  console.log(
    `Bounds: [[${geo.south}, ${geo.west}], [${geo.north}, ${geo.east}]]`
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const composites = [];
  let i = 0;
  const total = cols * rows;

  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) {
      i++;
      process.stdout.write(`\rDownloading ${i}/${total}…`);
      const buf = await fetchTile(tx, ty);
      composites.push({
        input: buf,
        left: (tx - xMin) * TILE,
        top: (ty - yMin) * TILE
      });
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  console.log('\nEncoding WebP + AVIF…');
  const stitched = sharp({
    create: { width, height, channels: 4, background: { r: 2, g: 6, b: 23, alpha: 1 } }
  }).composite(composites);

  await stitched.clone().webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(OUT_WEBP);
  await stitched.clone().avif({ quality: AVIF_QUALITY, effort: 6 }).toFile(OUT_AVIF);

  const webpStat = fs.statSync(OUT_WEBP);
  const avifStat = fs.statSync(OUT_AVIF);
  const boundsPath = path.join(OUT_DIR, 'world-dark-z4.bounds.json');
  fs.writeFileSync(
    boundsPath,
    JSON.stringify(
      {
        zoom: ZOOM,
        south: geo.south,
        west: geo.west,
        north: geo.north,
        east: geo.east,
        leaflet: [
          [geo.south, geo.west],
          [geo.north, geo.east]
        ]
      },
      null,
      2
    )
  );
  console.log(`✅ ${OUT_WEBP} (${(webpStat.size / 1024).toFixed(0)} KiB, q${WEBP_QUALITY})`);
  console.log(`✅ ${OUT_AVIF} (${(avifStat.size / 1024).toFixed(0)} KiB, q${AVIF_QUALITY})`);
  console.log(`✅ ${boundsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
