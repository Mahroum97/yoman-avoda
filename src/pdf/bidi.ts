/**
 * Bidirectional text handling for the PDF export.
 *
 * The important thing to know before touching this file: **fontkit already
 * reverses the glyph order** for a string containing Hebrew or Arabic (and it
 * shapes Arabic letter joining correctly), and it reverses
 * the *whole* run — including any digits or Latin words embedded in it. So
 * Hebrew-only text needs no help at all, while `31/07/2026` inside a Hebrew
 * sentence comes out as `6202/70/13`.
 *
 * The fix is not to reorder the string ourselves — that would fight fontkit and
 * double-reverse the Hebrew. It is to pre-reverse only the Latin/number
 * segments, so fontkit's reversal lands them the right way round:
 *
 *   logical   'תאריך 31/07/2026'
 *   passed    'תאריך 6202/70/13'   ← what this module produces
 *   fontkit   '31/07/2026 ךיראת'   ← reverses everything
 *   rendered   תאריך 31/07/2026     ← correct
 *
 * Word order is left logical, which also keeps copy-paste out of the PDF sane.
 */

/** Hebrew and Arabic blocks — both are written right to left. */
const RTL = /[֐-׿؀-ۿݐ-ݿיִ-﷿ﹰ-﻿]/;

/**
 * A left-to-right segment: letters or digits, optionally holding internal
 * punctuation such as the slashes of a date or the colon of a time. It has to
 * start and end on an alphanumeric so trailing commas stay with the Hebrew.
 */
const LTR_SEGMENT = /[0-9A-Za-z°][0-9A-Za-z°.,:/'"+%-]*[0-9A-Za-z°%]|[0-9A-Za-z°]/g;

const reverse = (text: string): string => [...text].reverse().join('');

/**
 * Brackets are mirrored in a right-to-left run: both sides of a pair open
 * towards the text they enclose. fontkit moves them but does not swap the
 * glyph, so `(מ"ק)` would come out inside-out — swapping them here first means
 * the reversal lands the right shape on each side.
 */
const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

/** Prepares a logical string for pdf-lib's `drawText`. */
export function pdfText(text: string): string {
  if (!text || !RTL.test(text)) return text;
  return text
    .replace(LTR_SEGMENT, reverse)
    .replace(/[()[\]{}<>]/g, (char) => MIRRORED[char] ?? char);
}

/**
 * Greedy word wrap measured in real glyph widths, returning logical lines.
 * Wrapping happens before `pdfText`, which is the correct order — wrapping a
 * transformed string would split the segments apart.
 */
export function wrapByWidth(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}
