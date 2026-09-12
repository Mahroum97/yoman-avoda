# Delivery and contractor reports

User-confirmed scope: received concrete and steel according to delivery notes;
daily worker count and worker-days per named contractor. No execution quantities,
working hours, rates or payment calculation are part of these reports.

## Source records

Each diary day may carry `deliveryLedger: {version: 1, rows, reviewed}`. A row
records material, exact quantity string, unit, supplier identity/name, delivery-note
number, specification, location and notes. The diary date is the receipt date.
Concrete uses cubic metres; steel uses kilograms or tonnes. One tonne is exactly
1,000 kilograms. Editing a delivery clears the day's completeness confirmation.

`ContractorRow` retains the printed `trade` and `workers` fields and adds optional
`contractorUid` and `contractorName`. The UID comes from an explicitly selected or
created address-book contact; the name is a historical snapshot. A shared trade,
similar name or contact rename does not assign labor to another contractor.

Five workers on each of twenty days is 100 worker-days, not 100 different people.
Multiple crew rows on one date contribute to that day's count; the date itself is
counted once. Individual worker identities are not collected by this feature.

## Calculations and unresolved records

`exactQuantity.ts` validates the entire numeric value, normalizes Arabic/Persian
digits and uses decimal strings plus BigInt arithmetic for addition and conversion.
It never interprets a range, an arithmetic expression or arbitrary description by
taking its first number. Exact legacy worker suffixes such as `3 עובדים` are read.
An ambiguous value such as `1,250` must be corrected to an unambiguous number.

`quantityReports()` filters project UID and the inclusive date range, excluding
trash. Concrete received never includes `casting.concreteQty` (execution data).
Steel is never extracted from `receivedToday` prose. Unreviewed days and old free
text are visible as coverage issues rather than being declared complete.

A counted delivery requires an appropriate unit, valid quantity, supplier name and
delivery-note number. Apparent repeated supplier/material/note/specification rows
are excluded together pending review; choosing one would be guessing. Missing or
invalid data is never a zero. Zero is counted only when explicitly recorded as a
valid quantity. A report with issues identifies its total as the known subtotal.

## Files and privacy

PDF and Excel consume the same immutable report result. Each file contains its own
project, period, unit, calculation rule, daily totals, original source rows and
issues. A selected contractor's file must not contain another contractor's rows,
even if the two contacts have the same name. Historical delivery prose is not
copied into a material/contractor file because it can include unrelated records.

Quantities remain exact strings for calculation. Excel receives numbers only when
they fit its numeric precision, and quantity totals are rounded to the source
decimal scale rather than leaving binary arithmetic residue. Values beyond Excel's
precision remain exact text. Original values and units remain available for review.

These reports support reconciliation of recorded deliveries and attendance. They
do not certify measured construction work, determine payment due, or establish an
inventory balance without opening stock, returns and consumption records.

## Reports-screen reachability and conflict safety

`QuantityReportsPanel` is part of the Reports screen and consumes the same live
project/date-keyed entry result as the combined and separate-summary exports. A range
change therefore removes the old controls until records for the requested range arrive;
an export can never reuse the previous period's array.

Concrete, steel and each identified contractor are choices in one neutral selector.
PDF, Excel and share start from that selected immutable report, and the source-day links
return to the editor for corrections. Unassigned workers remain a review group rather
than being guessed into a named contractor.

Reports refuse every unresolved causal conflict. Two live revision alternatives block
as a group even if one changed date; a single live edit racing a permanent deletion also
blocks through `syncConflictKind: 'deletion'`. The user must inspect and move the
unwanted revision to Trash, explicitly Save a deletion conflict to keep it, or move it
to Trash to confirm deletion before any PDF/XLSX can be created.

## Compatibility

The ledger is optional; no table/index or backup version changes are required.
Backups already retain the additional entry data. Sync serializers carry the ledger,
and omission by an older peer retains the current ledger. Explicit empty rows mean
a deliberate clear. Contractor name/UID fields are retained by stable row ID when
an older peer omits both; an explicit empty name clears the assignment.

Duplicating a day carries its crew identities but never copies yesterday's delivery
notes. The main printed A4 form keeps its established layout; structured delivery
records feed the separate delivery reports.

New report controls use neutral surfaces. Color marks invalid input or records that
need review, never a material category, contractor or quantity magnitude.
