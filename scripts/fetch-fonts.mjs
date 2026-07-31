/**
 * Downloads the Hebrew font files the PDF export embeds.
 *
 *   npm run fonts
 *
 * The results are committed to src/assets/fonts so the app keeps working with no
 * network — the PDF is generated on the device, including on a phone with no
 * signal. Heebo is licensed under the SIL Open Font License; the licence is
 * fetched alongside the files.
 *
 * Google Fonts serves a static, hebrew+latin subset TrueType file (~33 KB per
 * weight) when the request comes from a client too old for woff2; that is why
 * the ancient user agent below is deliberate, not a mistake.
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

const LICENCE_URLS = {
  'OFL-Heebo.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/OFL.txt',
  'OFL-Cairo.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/OFL.txt',
};

async function fetchTtf(family, weight, subset) {
  const cssUrl = `https://fonts.googleapis.com/css?family=${family}:${weight}&subset=${subset}`;
  const css = await fetch(cssUrl, { headers: { 'User-Agent': LEGACY_UA } }).then((r) =>
    r.text(),
  );
  const match = css.match(/url\((https:\/\/[^)]+)\)/);
  if (!match) throw new Error(`no font url in the css for weight ${weight}`);

  const buffer = Buffer.from(
    await fetch(match[1], { headers: { 'User-Agent': LEGACY_UA } }).then((r) =>
      r.arrayBuffer(),
    ),
  );
  // TrueType files start with 0x00010000; anything else means we were served
  // woff/eot and pdf-lib would reject it.
  if (buffer.readUInt32BE(0) !== 0x00010000) {
    throw new Error(`weight ${weight} came back as ${buffer.subarray(0, 4).toString('hex')}, not TrueType`);
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

  for (const [file, url] of Object.entries(LICENCE_URLS)) {
    await writeFile(join(OUT_DIR, file), await fetch(url).then((r) => r.text()));
    console.log(`✓ ${file}`);
  }
}

main().catch((error) => {
  console.error('הורדת הגופנים נכשלה:', error.message);
  process.exit(1);
});
