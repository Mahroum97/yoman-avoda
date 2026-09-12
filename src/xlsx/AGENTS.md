# src/xlsx/ — the spreadsheet export

Loaded when working in `src/xlsx/`.

`src/xlsx/` writes a real .xlsx by hand — an xlsx is a zip of XML parts, and jszip is
already in the tree because `docx` builds on it. A spreadsheet library was not worth its
weight for this, and writing the parts directly buys the thing a generic library will not
give: **`<sheetView rightToLeft="1"/>`**, without which a Hebrew workbook opens mirrored
with column A on the wrong side.

Quantities are written as **numbers**, not as the free text the form stores, or a column
of workers will not sum — which is the only reason to export a spreadsheet rather than a
PDF. `npm run sample` writes `tmp/sample-range-{he,en}.xlsx`; check both, since the RTL
flag changes the sheet XML.
