/**
 * Rasterises public/favicon.svg into the PNG sizes the web app manifest needs.
 *
 *   npm run icons
 *
 * Uses headless Chrome (already on any Mac with Chrome installed) rather than
 * adding a native image dependency for something that runs once in a while.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const OUT_DIR = 'public/icons';
const TMP_DIR = 'tmp/icons';

/** `maskable` needs ~10% safe padding on every edge for Android's mask. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.1 },
];

/** The sizes `iconutil` needs to assemble a macOS .icns. */
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];

async function render(svg, { file, size, padding }, outDir = OUT_DIR) {
  const inset = Math.round(size * padding);
  const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#0f2d4a}
  body{width:${size}px;height:${size}px;display:grid;place-items:center}
  svg{width:${size - inset * 2}px;height:${size - inset * 2}px}
</style>
${svg}`;

  const htmlPath = join(TMP_DIR, `${file}.html`);
  await writeFile(htmlPath, html);

  await run(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    `--screenshot=${join(outDir, file)}`,
    `file://${join(process.cwd(), htmlPath)}`,
  ]);

  console.log(`✓ ${join(outDir, file)} (${size}×${size})`);
}

/**
 * Builds build/icon.icns for the macOS app from the same artwork, using the
 * iconset layout iconutil expects.
 */
async function buildIcns(svg) {
  const iconset = 'build/icon.iconset';
  await mkdir(iconset, { recursive: true });

  for (const size of ICNS_SIZES) {
    await render(svg, { file: `icon_${size}x${size}.png`, size, padding: 0 }, iconset);
    // Retina variants: a 32px @2x slot holds the 64px rendering, and so on.
    if (size >= 32) {
      await render(svg, { file: `icon_${size / 2}x${size / 2}@2x.png`, size, padding: 0 }, iconset);
    }
  }

  await run('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns']);
  await rm(iconset, { recursive: true, force: true });
  console.log('✓ build/icon.icns');
}

/**
 * The iPhone app icon. Modern Xcode takes a single 1024px image; it must be
 * fully opaque with no alpha channel, which is why it is rendered on the navy
 * background rather than exported from the SVG directly.
 */
async function buildIosIcon(svg) {
  const dir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  try {
    await render(svg, { file: 'AppIcon-512@2x.png', size: 1024, padding: 0 }, dir);
  } catch {
    console.log('· iOS project not present, skipping the app icon');
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir('build', { recursive: true });
  const svg = await readFile('public/favicon.svg', 'utf8');
  for (const target of TARGETS) await render(svg, target);
  await buildIcns(svg);
  await buildIosIcon(svg);
  await rm(TMP_DIR, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('יצירת האייקונים נכשלה:', error.message);
  console.error('אפשר להגדיר CHROME_PATH אם Chrome מותקן במיקום אחר.');
  process.exit(1);
});
