#!/bin/bash
#
# Says one line when the code has changed since the last push to the devices.
#
# This is wired to Claude Code's Stop hook, so it runs at the end of every turn
# and has to stay effectively free: a single `find` that stops at the first hit,
# no build, no network. Anything heavier would block the session.
#
# Deliberately a reminder rather than the push itself. Stop fires after every
# reply — including ones that only read a file or answered a question — so an
# automatic push here would rebuild for minutes at a time, publish half-finished
# work to the phone mid-task, and put unreviewed code on the public web. The
# push stays one deliberate action; this only makes sure it is not forgotten.

cd "$(dirname "$0")/.." || exit 0

STAMP=.push-stamp

# Never pushed from this checkout — there is no "behind" to report yet.
[ -f "$STAMP" ] || exit 0

CHANGED=$(find src electron public index.html package.json capacitor.config.ts \
  -newer "$STAMP" -type f -print -quit 2>/dev/null)

[ -n "$CHANGED" ] || exit 0

printf 'יש שינויים שעדיין לא נדחפו למכשירים — לחיצה כפולה על "דחיפה לכל המכשירים.command" (או npm run push)\n'
exit 0
