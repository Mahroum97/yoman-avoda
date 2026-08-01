#!/bin/bash
#
# Pushes the current code everywhere the diary runs:
#
#   • this Mac       — rebuilds the app and installs it into /Applications
#   • iPhone / iPad  — installs the native app on every connected device
#   • the web        — publishes the PWA to GitHub Pages, for installing without a cable
#
#   npm run push
#
# The web assets are built once at the top and every leg reuses them, which is
# why each sub-script honours YOMAN_SKIP_BUILD — otherwise a single push would
# run four identical Vite builds.
#
# No `set -e`: the legs are independent on purpose. An iPad that has not been
# trusted yet must not stop the Mac app from being updated, and a missing GitHub
# remote must not stop either of them. Every leg records its own outcome and the
# summary at the end says exactly what reached where.

set -uo pipefail
cd "$(dirname "$0")/.."

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
BUNDLE_ID=com.mahroum.yoman
STAMP=.push-stamp

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'
BOLD=$'\033[1m'; OFF=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$BLUE$BOLD" "$1" "$OFF"; }

MAC_STATUS="לא בוצע"
IOS_STATUS="לא בוצע"
WEB_STATUS="לא בוצע"
PUSHED_ANY=0

# ---------------------------------------------------------------- the assets

printf '%s== דחיפת יומן עבודה לכל המכשירים ==%s\n' "$BOLD" "$OFF"

step "בונה את האתר"
if ! npm run build; then
  printf '\n%s✖ בניית האתר נכשלה — אין מה לדחוף.%s\n' "$RED$BOLD" "$OFF" >&2
  printf '  שום מכשיר לא שונה.\n' >&2
  exit 1
fi
export YOMAN_SKIP_BUILD=1

# ------------------------------------------------------------------- the Mac

step "בונה את אפליקציית ה-Mac"
if npx electron-builder --config electron-builder.yml; then
  APP_SRC=$(find release -maxdepth 2 -name '*.app' -print -quit 2>/dev/null)
  if [ -z "$APP_SRC" ]; then
    MAC_STATUS="נבנה, אך לא נמצאה אפליקציה בתיקיית release"
  else
    APP_DEST="/Applications/$(basename "$APP_SRC")"

    # A bundle cannot be replaced from under a running process, so the open copy
    # is asked to quit first — asked, not killed: a graceful quit lets the window
    # close normally instead of dropping whatever is on screen.
    app_running() { pgrep -f "$1/Contents/MacOS/" >/dev/null 2>&1; }

    if app_running "$APP_DEST"; then
      printf '  האפליקציה פתוחה — מבקש ממנה להיסגר\n'
      osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
      for _ in 1 2 3 4 5 6 7 8; do
        app_running "$APP_DEST" || break
        sleep 1
      done
    fi

    if app_running "$APP_DEST"; then
      MAC_STATUS="דולג — האפליקציה עדיין פתוחה. סגור אותה והרץ שוב"
    elif rm -rf "$APP_DEST" && ditto "$APP_SRC" "$APP_DEST"; then
      MAC_STATUS="הותקן ב-$APP_DEST"
      PUSHED_ANY=1
    else
      MAC_STATUS="ההעתקה ל-/Applications נכשלה"
    fi
  fi
else
  MAC_STATUS="הבנייה נכשלה"
fi
printf '  %s\n' "$MAC_STATUS"

# ------------------------------------------------------- the iPhone and iPad

step "מתקין על האייפון והאייפד"
# ios-install.sh names the devices it reached and the ones it could not, so the
# summary can say "the phone got it, the iPad was skipped" instead of claiming
# every connected device was updated.
IOS_STATUS_FILE=$(mktemp -t yoman-ios-status)
if YOMAN_STATUS_FILE="$IOS_STATUS_FILE" bash scripts/ios-install.sh; then
  PUSHED_ANY=1
fi
if [ -s "$IOS_STATUS_FILE" ]; then
  IOS_STATUS=$(cat "$IOS_STATUS_FILE")
else
  IOS_STATUS="לא בוצע — ראה את ההסבר למעלה"
fi
rm -f "$IOS_STATUS_FILE"

# ------------------------------------------------------------------- the web

step "מפרסם לאינטרנט"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  WEB_STATUS="דולג — התיקייה אינה מאגר git"
elif ! git remote get-url origin >/dev/null 2>&1; then
  WEB_STATUS="דולג — עדיין אין מאגר ב-GitHub"
  cat <<'EOS'
  עוד לא יצרת מאגר ב-GitHub, אז אין לאן לפרסם.
  זו פקודה אחת בטרמינל, ואחריה הפרסום יעבוד לבד בכל דחיפה:

      cd "$HOME/Desktop/יומן עבודה" && gh repo create yoman-avoda --public --source=. --remote=origin --push

  אחרי זה האייפד יוכל להתקין את היומן מהאינטרנט, בלי כבל.
EOS
elif bash scripts/deploy-pages.sh; then
  WEB_STATUS="פורסם"
  PUSHED_ANY=1
else
  WEB_STATUS="הפרסום נכשל"
fi

# --------------------------------------------------------------- the summary

if [ "$PUSHED_ANY" = 1 ]; then
  # Marks the moment everything was in sync. `push-reminder.sh` compares the
  # source files against this to notice when a device has fallen behind.
  touch "$STAMP"
fi

line() {
  case "$2" in
    *נכשל*|*דולג*|*לא\ הותקן*|*לא\ בוצע*) printf '  %s•%s %-12s %s\n' "$YELLOW" "$OFF" "$1" "$2" ;;
    *) printf '  %s✔%s %-12s %s\n' "$GREEN" "$OFF" "$1" "$2" ;;
  esac
}

printf '\n%s== סיכום ==%s\n' "$BOLD" "$OFF"
line "Mac"        "$MAC_STATUS"
line "אייפון/אייפד" "$IOS_STATUS"
line "אינטרנט"     "$WEB_STATUS"

if [ "$PUSHED_ANY" = 1 ]; then
  printf '\n%s%s✔ הדחיפה הסתיימה%s\n' "$GREEN" "$BOLD" "$OFF"
  exit 0
fi

printf '\n%s%s✖ שום מכשיר לא עודכן%s\n' "$RED" "$BOLD" "$OFF"
exit 1
