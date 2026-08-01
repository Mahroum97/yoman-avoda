#!/bin/bash
#
# לחיצה כפולה על הקובץ הזה מעדכנת את היומן:
# מתקינה תלויות, בונה מחדש את האתר, ובונה מחדש את אפליקציית ה-Mac.
#
# הקובץ נשאר פתוח בסוף כדי שאפשר יהיה לקרוא את התוצאה.

cd "$(dirname "$0")" || exit 1

# On a double-click the shell starts without the usual PATH, so node installed
# by Homebrew or nvm is not found. Add the usual places before anything else.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

BOLD=$'\033[1m'
GREEN=$'\033[32m'
RED=$'\033[31m'
BLUE=$'\033[34m'
OFF=$'\033[0m'

step() { printf '\n%s▸ %s%s\n' "$BLUE$BOLD" "$1" "$OFF"; }
fail() {
  printf '\n%s✖ %s%s\n' "$RED$BOLD" "$1" "$OFF"
  printf '\nהחלון יישאר פתוח. אפשר לצלם את השגיאה ולשלוח אותה.\n'
  read -r -p "לחץ Enter לסגירה… " _
  exit 1
}

printf '%s\n' "$BOLD== עדכון יומן עבודה ==$OFF"

command -v node >/dev/null 2>&1 || fail "לא נמצא Node.js במחשב. יש להתקין אותו מ-nodejs.org ולנסות שוב."
printf 'Node.js %s\n' "$(node -v)"

step "מתקין תלויות"
npm install --no-fund --no-audit || fail "התקנת התלויות נכשלה"

# From here on the update *is* the push: building without putting the result on
# the devices was the step that kept getting forgotten, which is how a phone
# ends up running last week's diary. push-all.sh builds once and sends the same
# build to the Mac, to every connected iPhone and iPad, and to the web.
bash scripts/push-all.sh
PUSH_RESULT=$?

if [ "$PUSH_RESULT" -ne 0 ]; then
  printf '\n%s⚠ העדכון נבנה, אבל לא כל המכשירים עודכנו — ראה את הסיכום למעלה.%s\n' "$RED" "$OFF"
fi

printf '\nלהרצת האתר מקומית: npm run dev\n'
printf 'לדחיפה חוזרת בלבד: לחיצה כפולה על "דחיפה לכל המכשירים.command"\n'

read -r -p $'\nלחץ Enter לסגירה… ' _
