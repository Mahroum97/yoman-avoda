/**
 * Downloads the font files the app ships with.
 *
 *   npm run fonts
 *
 * Two sets, in two formats, for two different jobs:
 *
 *  - **TrueType**, for the PDF. `pdf-lib` embeds TTF and cannot read woff2.
 *  - **woff2**, for the interface. A third the size, and the only reason it is
 *    affordable to offer a choice of typeface at all.
 *
 * The results are committed to src/assets/fonts so the app keeps working with no
 * network — the PDF is generated on the device, including on a phone with no
 * signal. Every family here is under the SIL Open Font License or Apache 2.0;
 * the licences are fetched alongside the files.
 *
 * Google Fonts serves a static, subsetted TrueType file when the request comes
 * from a client too old for woff2; that is why the ancient user agent below is
 * deliberate, not a mistake.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LEGACY_UA =
  'Mozilla/5.0 (Linux; U; Android 4.0.3; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Safari/534.30';

const OUT_DIR = 'src/assets/fonts';

/**
 * Heebo covers Hebrew + Latin; Cairo covers Arabic + Latin. The PDF picks the
 * pair that matches the report language.
 */
const FONTS = [
  { family: 'Heebo', subset: 'hebrew,latin', weight: 400, file: 'heebo-regular.ttf' },
  { family: 'Heebo', subset: 'hebrew,latin', weight: 700, file: 'heebo-bold.ttf' },
  { family: 'Cairo', subset: 'arabic,latin', weight: 400, file: 'cairo-regular.ttf' },
  { family: 'Cairo', subset: 'arabic,latin', weight: 700, file: 'cairo-bold.ttf' },
];

/**
 * The typefaces the interface can be set to, as woff2.
 *
 * One per idea rather than one per taste: a workhorse, something friendlier,
 * something rounded, a serif for people who want the diary to look like a
 * printed form, and a fixed-width one — which is the hardest thing to find in
 * Hebrew and the reason Cousine is here.
 */
const UI_FONTS = [
  { family: 'Heebo', subset: 'hebrew,latin', weights: [400, 600, 700], slug: 'heebo' },
  { family: 'Assistant', subset: 'hebrew,latin', weights: [400, 600, 700], slug: 'assistant' },
  { family: 'Rubik', subset: 'hebrew,latin', weights: [400, 500, 700], slug: 'rubik' },
  { family: 'Frank Ruhl Libre', subset: 'hebrew,latin', weights: [400, 700], slug: 'frank' },
  { family: 'Cousine', subset: 'hebrew,latin', weights: [400, 700], slug: 'cousine' },
  { family: 'Cairo', subset: 'arabic,latin', weights: [400, 600, 700], slug: 'cairo' },
  { family: 'Tajawal', subset: 'arabic,latin', weights: [400, 500, 700], slug: 'tajawal' },
];

const UI_DIR = 'src/assets/fonts/ui';

const LICENCE_URLS = {
  'OFL-Heebo.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/OFL.txt',
  'OFL-Cairo.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/OFL.txt',
  'OFL-Assistant.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/assistant/OFL.txt',
  'OFL-Rubik.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/OFL.txt',
  'OFL-FrankRuhlLibre.txt':
    'https://raw.githubusercontent.com/google/fonts/main/ofl/frankruhllibre/OFL.txt',
  'LICENCE-Cousine.txt':
    'https://raw.githubusercontent.com/google/fonts/main/apache/cousine/LICENSE.txt',
  'OFL-Tajawal.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/OFL.txt',
};

/** Chrome, because Google Fonts only answers with woff2 for a browser it knows. */
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

/**
 * The woff2 files for one weight, as [subset, bytes] pairs.
 *
 * `css2` answers with one @font-face per unicode-range — hebrew, latin, math,
 * symbols, latin-ext — each labelled by a comment above it. Only the script the
 * interface needs and the Latin that carries its dates and numbers are kept;
 * the rest is a few hundred kilobytes of glyphs this app will never draw.
 */
async function fetchWoff2(family, weight, wanted) {
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const css = await fetch(cssUrl, { headers: { 'User-Agent': MODERN_UA } }).then((r) => r.text());

  const out = [];
  // Each block is preceded by its subset name in a comment: /* hebrew */
  const pattern = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, body] of css.matchAll(pattern)) {
    if (!wanted.includes(subset)) continue;
    const url = body.match(/url\((https:\/\/[^)]+\.woff2)\)/);
    if (!url) continue;
    const buffer = Buffer.from(
      await fetch(url[1], { headers: { 'User-Agent': MODERN_UA } }).then((r) => r.arrayBuffer()),
    );
    out.push([subset, buffer]);
  }
  if (out.length === 0) throw new Error(`no woff2 for ${family} ${weight}`);
  return out;
}

/** The TrueType the PDF embeds. pdf-lib cannot read woff or woff2. */
async function fetchTtf(family, weight, subset) {
  const cssUrl = `https://fonts.googleapis.com/css?family=${family}:${weight}&subset=${subset}`;
  const css = await fetch(cssUrl, { headers: { 'User-Agent': LEGACY_UA } }).then((r) => r.text());
  const match = css.match(/url\((https:\/\/[^)]+)\)/);
  if (!match) throw new Error(`no font url in the css for weight ${weight}`);

  const buffer = Buffer.from(
    await fetch(match[1], { headers: { 'User-Agent': LEGACY_UA } }).then((r) => r.arrayBuffer()),
  );
  // TrueType files start with 0x00010000; anything else means we were served
  // woff/eot and pdf-lib would reject it.
  if (buffer.readUInt32BE(0) !== 0x00010000) {
    throw new Error(
      `weight ${weight} came back as ${buffer.subarray(0, 4).toString('hex')}, not TrueType`,
    );
  }
  return buffer;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const { family, weight, subset, file } of FONTS) {
    const buffer = await fetchTtf(family, weight, subset);
    await writeFile(join(OUT_DIR, file), buffer);
    console.log(`✓ ${file} — ${(buffer.length / 1024).toFixed(0)} KB`);
  }

  await mkdir(UI_DIR, { recursive: true });
  for (const { family, subset, weights, slug } of UI_FONTS) {
    const wanted = subset.split(',');
    for (const weight of weights) {
      for (const [name, buffer] of await fetchWoff2(family, weight, wanted)) {
        const file = `${slug}-${weight}-${name}.woff2`;
        await writeFile(join(UI_DIR, file), buffer);
        console.log(`✓ ui/${file} — ${(buffer.length / 1024).toFixed(0)} KB`);
      }
    }
  }

  for (const [file, url] of Object.entries(LICENCE_URLS)) {
    await writeFile(join(OUT_DIR, file), await fetch(url).then((r) => r.text()));
    console.log(`✓ ${file}`);
  }
}

main().catch((error) => {
  console.error('הורדת הגופנים נכשלה:', error.message);
  process.exit(1);
});
