/**
 * The diary page as a picture, rendered from the PDF itself.
 *
 * The point of going through the PDF rather than drawing the page again is that
 * there is nothing to keep in sync: the image is the document, photographed.
 * Every embedded font, every column width, every wrapped line is whatever the
 * exported file has — so an image sent to a supervisor cannot quietly differ
 * from the PDF sent to the same person an hour later.
 *
 * An image exists because of how a page actually gets sent. A PDF arrives in
 * WhatsApp as a file to download and open; a picture arrives as something you
 * can already see, which on a phone on a site is the whole difference.
 */
import { logger } from '../lib/log';

const log = logger('image');

/**
 * 2× the PDF's own 72dpi, so an A4 page comes out about 1191×1684.
 *
 * Enough to read the crew table when someone pinches into it, and small enough
 * that a day's page is a few hundred kilobytes rather than several megabytes —
 * which matters when the next thing that happens to it is being sent over a
 * phone's data connection from a building site.
 */
const SCALE = 2;

/** JPEG rather than PNG: a page of ruled tables compresses to a third the size. */
const MIME = 'image/jpeg';
const QUALITY = 0.92;

/**
 * pdf.js is loaded only when someone asks for an image.
 *
 * It is by far the largest thing in the tree, and the great majority of days
 * end with a PDF or nothing at all — so it stays out of the way until the
 * button is pressed, exactly as `pdf-lib` and `docx` do.
 */
async function loadRenderer() {
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
  ]);
  // Without this pdf.js reaches for a worker on a CDN, which would break the
  // one promise this app makes: that it works with no network at all.
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Every page of a PDF, as image blobs, in order. */
export async function pdfToImages(bytes: Uint8Array): Promise<Blob[]> {
  const pdfjs = await loadRenderer();
  // A copy: pdf.js takes ownership of the buffer it is handed and detaches it,
  // and the caller may well still want the PDF it just built.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  const images: Blob[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');

      // The page is drawn on white rather than on transparency: a JPEG has no
      // alpha, and a transparent background would come out black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, MIME, QUALITY),
      );
      if (blob) images.push(blob);

      // Freed as we go: a range report can be thirty A4 pages, and holding
      // thirty full-size canvases on a phone is how a tab gets killed.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  log.info('pdf rendered to images', { pages: images.length, bytes: images.reduce((n, b) => n + b.size, 0) });
  return images;
}
