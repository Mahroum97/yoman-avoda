/**
 * How the photo appendix is split into pages.
 *
 * This number is shared by the three things that have to agree about it: the
 * PDF builder that draws the tiles, the page count printed in every header, and
 * the on-screen A4 preview. They disagreed once — the count assumed four photos
 * to a page while the drawing loop put every photo on a single page — and a ten
 * photo day came out as "page 1 of 4" in a document with two pages in it, the
 * last four photos drawn past the bottom edge where nothing can see them.
 *
 * The value comes from the PDF's own geometry: an A4 page less its margins, the
 * header band, the footer band and the gap between them leaves room for four
 * rows of two tiles. `src/pdf/build.ts` recomputes it from `METRICS` and throws
 * at import if this constant no longer matches, so changing a height there
 * cannot quietly desynchronise the preview.
 */
export const PHOTOS_PER_PAGE = 8;

/** How many appendix pages `n` photos need. */
export const photoPageCount = (n: number): number => Math.ceil(n / PHOTOS_PER_PAGE);
