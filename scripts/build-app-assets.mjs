/**
 * Split public/index.html into cacheable assets (run after editing the monolith, or once).
 * Normal workflow: edit public/assets/app.js + app.css + index shell directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const ASSETS = path.join(ROOT, 'public', 'assets');

const html = fs.readFileSync(INDEX, 'utf8');

if (!html.includes('<style>')) {
  console.log('index.html already split — skip');
  process.exit(0);
}

const styleStart = html.indexOf('<style>') + 7;
const styleEnd = html.indexOf('</style>');
const css = html.slice(styleStart, styleEnd).trim();

const mainScriptStart = html.indexOf('<script>\n    // Generate / retrieve');
const mainScriptEnd = html.lastIndexOf('</script>');
const js = html.slice(mainScriptStart + 8, mainScriptEnd).trim();

const bodyStart = html.indexOf('<body>') + 6;
const bodyEnd = html.indexOf('<script\n    src="https://unpkg.com/leaflet');
const body = html.slice(bodyStart, bodyEnd).trim();

fs.mkdirSync(ASSETS, { recursive: true });
fs.writeFileSync(path.join(ASSETS, 'app.css'), css);
fs.writeFileSync(path.join(ASSETS, 'app.js'), js);

const shell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SimpyMap - Julie&apos;s World</title>
  <script>
    (function () {
      var url = '/map/world-dark-z4.webp';
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 1;
        if (c.toDataURL('image/avif').indexOf('image/avif') > 0) url = '/map/world-dark-z4.avif';
      } catch (e) {}
      window.__MAP_IMAGE_URL__ = url;
      var link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = url;
      link.type = url.endsWith('.avif') ? 'image/avif' : 'image/webp';
      document.head.appendChild(link);
    })();
  </script>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <link rel="stylesheet" href="/assets/app.css?v=__ASSET_V__" />
</head>
<body>
${body}
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script src="/assets/app.js?v=__ASSET_V__" defer></script>
</body>
</html>
`;

fs.writeFileSync(INDEX, shell);
console.log(`✅ assets/app.css (${(css.length / 1024).toFixed(1)} KiB)`);
console.log(`✅ assets/app.js (${(js.length / 1024).toFixed(1)} KiB)`);
console.log(`✅ index.html shell (${(shell.length / 1024).toFixed(1)} KiB)`);
