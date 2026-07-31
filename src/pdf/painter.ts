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
import { COLORS, PAGE, TYPE } from './theme';
import type { Direction } from '../i18n/strings';
import { pdfText, wrapByWidth } from './bidi';

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
  /** Extra spacing between the box edge and the text. */
  pad?: number;
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

  constructor(page: PDFPage, fonts: Fonts, dir: Direction = 'rtl') {
    this.page = page;
    this.fonts = fonts;
    this.dir = dir;
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

  /** Width of a string as it will actually be drawn. */
  width(text: string, options: TextOptions = {}): number {
    const size = options.size ?? TYPE.cell;
    return this.font(text, options.bold).widthOfTextAtSize(pdfText(text), size);
  }

  /** Draws text with its left edge at `x` and its cap-height near `top`. */
  text(text: string, x: number, top: number, options: TextOptions = {}): void {
    if (!text) return;
    const size = options.size ?? TYPE.cell;
    this.page.drawText(pdfText(text), {
      x,
      y: PAGE.height - top - size,
      size,
      font: this.font(text, options.bold),
      color: options.color ?? COLORS.ink,
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
      color: options.color ?? COLORS.line,
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
