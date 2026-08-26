/**
 * A small drawing surface over a pdf-lib page.
 *
 * Two things it exists to hide:
 *  - pdf-lib's origin is the bottom-left corner; a form is far easier to lay out
 *    from the top down, so every y here is measured from the top edge.
 *  - every string has to pass through `pdfText` before it is drawn, or embedded
 *    dates and numbers come out backwards. Routing all text through this class
 *    is what guarantees that is never forgotten.
 */
import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib';
import { COLORS, PAGE, TYPE, type Palette } from './theme';
import type { Direction } from '../i18n/strings';
import { pdfText, wrapByWidth } from './bidi';

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
  /** Extra spacing between the box edge and the text. */
  pad?: number;
  /**
   * The widest the string may be drawn, in points.
   *
   * A table cell is a fixed box and the words that go in it are typed by hand:
   * `אינסטלטור צוות ספרינקלרים` in a column sized for `חשמלאי` printed straight
   * across its neighbour, over the rule between them. With this set the string
   * is shrunk to fit and, only if that is not enough, cut short — see `fit`.
   */
  maxWidth?: number;
  /** How far `maxWidth` may shrink the size before the text is cut instead. */
  minSize?: number;
}

/**
 * Both script families are embedded in every document, and the font is chosen
 * per string. A diary written in Hebrew stays readable when the report language
 * is Arabic (and vice versa) — one font cannot cover both scripts.
 */
export interface Fonts {
  hebrew: { regular: PDFFont; bold: PDFFont };
  arabic: { regular: PDFFont; bold: PDFFont };
}

const HAS_ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const HAS_HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;

export class Painter {
  private readonly page: PDFPage;
  private readonly fonts: Fonts;
  readonly dir: Direction;
  /** The document palette; every drawing helper reads its colours from here. */
  readonly colors: Palette;

  constructor(
    page: PDFPage,
    fonts: Fonts,
    dir: Direction = 'rtl',
    colors: Palette = COLORS,
  ) {
    this.page = page;
    this.fonts = fonts;
    this.dir = dir;
    this.colors = colors;
  }

  /** Aligns to the edge the language starts at. */
  textStart(text: string, startX: number, top: number, options: TextOptions = {}): void {
    if (this.dir === 'rtl') this.textRight(text, startX, top, options);
    else this.text(text, startX, top, options);
  }

  /** Start-aligned and vertically centred in a box of height `h`. */
  textStartBox(
    text: string,
    startX: number,
    top: number,
    h: number,
    options: TextOptions = {},
  ): void {
    const size = options.size ?? TYPE.cell;
    const pad = options.pad ?? 0;
    const x = this.dir === 'rtl' ? startX - pad : startX + pad;
    this.textStart(text, x, top + (h - size) / 2, options);
  }

  /** Picks the family that can actually draw this string. */
  private font(text: string, bold?: boolean): PDFFont {
    const family =
      HAS_ARABIC.test(text) ? this.fonts.arabic
      : HAS_HEBREW.test(text) ? this.fonts.hebrew
      : this.dir === 'rtl' ? this.fonts.hebrew
      : this.fonts.hebrew;
    return bold ? family.bold : family.regular;
  }

  /**
   * The string and the size a `maxWidth` leaves it, which is what every other
   * helper here measures and draws.
   *
   * Shrinking comes first, because a trade name read at seven points is still
   * the trade name; cutting is the last resort and is marked with an ellipsis
   * so nobody mistakes the shortened text for what was typed. Both halves go
   * through the same function, so the width used to align a string is always
   * the width the string is actually drawn at.
   */
  private fit(text: string, options: TextOptions): { text: string; size: number } {
    const size = options.size ?? TYPE.cell;
    const max = options.maxWidth;
    if (!max || !text) return { text, size };

    const font = this.font(text, options.bold);
    const widthAt = (value: string, at: number) => font.widthOfTextAtSize(pdfText(value), at);

    const full = widthAt(text, size);
    if (full <= max) return { text, size };

    const floor = options.minSize ?? size * 0.72;
    const shrunk = Math.max(floor, (size * max) / full);
    if (widthAt(text, shrunk) <= max) return { text, size: shrunk };

    let cut = text;
    while (cut.length > 1 && widthAt(`${cut}…`, shrunk) > max) cut = cut.slice(0, -1);
    return { text: `${cut}…`, size: shrunk };
  }

  /** Width of a string as it will actually be drawn. */
  width(text: string, options: TextOptions = {}): number {
    const fitted = this.fit(text, options);
    return this.font(fitted.text, options.bold).widthOfTextAtSize(
      pdfText(fitted.text),
      fitted.size,
    );
  }

  /** Draws text with its left edge at `x` and its cap-height near `top`. */
  text(text: string, x: number, top: number, options: TextOptions = {}): void {
    if (!text) return;
    const fitted = this.fit(text, options);
    this.page.drawText(pdfText(fitted.text), {
      x,
      y: PAGE.height - top - (options.size ?? TYPE.cell),
      size: fitted.size,
      font: this.font(fitted.text, options.bold),
      color: options.color ?? this.colors.ink,
    });
  }

  /** Right-aligned — the default for Hebrew, where `right` is the start edge. */
  textRight(text: string, right: number, top: number, options: TextOptions = {}): void {
    if (!text) return;
    this.text(text, right - this.width(text, options), top, options);
  }

  textCenter(text: string, centre: number, top: number, options: TextOptions = {}): void {
    if (!text) return;
    this.text(text, centre - this.width(text, options) / 2, top, options);
  }

  /** Right-aligned text vertically centred inside a box of height `h`. */
  textInBox(
    text: string,
    right: number,
    top: number,
    h: number,
    options: TextOptions = {},
  ): void {
    const size = options.size ?? TYPE.cell;
    this.textRight(text, right - (options.pad ?? 0), top + (h - size) / 2, options);
  }

  /** Centred both ways inside a box — used for every table cell. */
  textCentreBox(
    text: string,
    centre: number,
    top: number,
    h: number,
    options: TextOptions = {},
  ): void {
    const size = options.size ?? TYPE.cell;
    this.textCenter(text, centre, top + (h - size) / 2, options);
  }

  /**
   * A table cell that holds more than it was drawn for.
   *
   * Shrinking a long trade name until it fits leaves it at six points beside
   * neighbours at eight and a half — legible, but only just. A cell is taller
   * than one line, so the text is wrapped onto two before it is shrunk, and the
   * pair is centred in the box the way the single line would have been.
   * Anything that still will not fit falls back to `maxWidth`, which shrinks
   * and, in the end, cuts.
   */
  textCellBox(
    text: string,
    centre: number,
    top: number,
    h: number,
    maxWidth: number,
    options: TextOptions = {},
  ): void {
    if (!text) return;
    const size = options.size ?? TYPE.cell;
    if (this.width(text, { ...options, maxWidth: undefined }) <= maxWidth) {
      this.textCentreBox(text, centre, top, h, options);
      return;
    }

    const small = { ...options, size: size * 0.85 };
    const lines = this.wrap(text, maxWidth, small);
    const lineH = (small.size ?? size) * 1.2;
    if (lines.length === 2 && lines.length * lineH <= h - 2) {
      let y = top + (h - lines.length * lineH) / 2;
      for (const line of lines) {
        this.textCenter(line, centre, y, small);
        y += lineH;
      }
      return;
    }

    this.textCentreBox(text, centre, top, h, { ...options, maxWidth });
  }

  rect(
    x: number,
    top: number,
    w: number,
    h: number,
    options: { fill?: RGB; stroke?: RGB; lineWidth?: number } = {},
  ): void {
    this.page.drawRectangle({
      x,
      y: PAGE.height - top - h,
      width: w,
      height: h,
      color: options.fill,
      borderColor: options.stroke,
      borderWidth: options.stroke ? (options.lineWidth ?? 0.6) : undefined,
    });
  }

  line(
    x1: number,
    top1: number,
    x2: number,
    top2: number,
    options: { color?: RGB; width?: number } = {},
  ): void {
    this.page.drawLine({
      start: { x: x1, y: PAGE.height - top1 },
      end: { x: x2, y: PAGE.height - top2 },
      thickness: options.width ?? 0.6,
      color: options.color ?? this.colors.line,
    });
  }

  image(img: PDFImage, x: number, top: number, w: number, h: number): void {
    this.page.drawImage(img, { x, y: PAGE.height - top - h, width: w, height: h });
  }

  /** Wraps logical text to a pixel width, for the ruled writing areas. */
  wrap(text: string, maxWidth: number, options: TextOptions = {}): string[] {
    return wrapByWidth(text, maxWidth, (t) => this.width(t, options));
  }
}
