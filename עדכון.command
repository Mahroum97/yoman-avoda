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

step "בונה את האתר"
npm run build || fail "בניית האתר נכשלה"

step "בונה את אפליקציית ה-Mac"
if npm run app:build; then
  APP_PATH="$(find release -maxdepth 2 -name '*.app' -print -quit 2>/dev/null)"
  DMG_PATH="$(find release -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null)"
else
  printf '\n%s⚠ בניית אפליקציית ה-Mac נכשלה, אבל האתר עודכן בהצלחה.%s\n' "$RED" "$OFF"
fi

printf '\n%s✔ העדכון הושלם%s\n' "$GREEN$BOLD" "$OFF"
printf '  • האתר המעודכן נמצא בתיקייה: %s\n' "$(pwd)/dist"
[ -n "$APP_PATH" ] && printf '  • האפליקציה: %s\n' "$APP_PATH"
[ -n "$DMG_PATH" ] && printf '  • קובץ ההתקנה: %s\n' "$DMG_PATH"
printf '\nלהרצת האתר מקומית: npm run dev\n'

read -r -p $'\nלחץ Enter לסגירה… ' _
