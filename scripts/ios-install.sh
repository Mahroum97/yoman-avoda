#!/bin/bash
#
# Builds the diary and installs it on every iPhone and iPad connected to this Mac.
#
#   npm run ios:run                        # everything that is connected
#   IOS_DEVICE_ID=<udid> npm run ios:run   # one device only
#   YOMAN_SKIP_BUILD=1 npm run ios:run     # assets already built by push-all.sh
#
# Signing is the one part this cannot do on its own: iOS refuses to run an
# unsigned app. Add an Apple ID once in Xcode → Settings → Accounts, and this
# script picks up the team automatically from then on.
#
# Note there is no `set -e`. A device that is asleep, or an iPad that has not
# been trusted yet, must not stop the app reaching the devices that *are* ready.

set -uo pipefail
cd "$(dirname "$0")/.."

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
BUNDLE_ID=com.mahroum.yoman

# Build outside the project folder, on purpose.
#
# Not on the Desktop, and not in ${TMPDIR} either.
#
# The Desktop is synced to iCloud Drive, and the file provider stamps every file
# written there with com.apple.FinderInfo. codesign refuses to sign anything
# carrying it ("resource fork, Finder information, or similar detritus not
# allowed"), and clearing the attributes does not hold because they are re-added
# as the build writes new files.
#
# ${TMPDIR} solved that and introduced a worse one: macOS reaps files under
# /var/folders/…/T/ that have not been touched for a few days, and it does it
# file by file. It emptied the capacitor-swift-pm checkout overnight while
# leaving the directory and SPM's workspace-state.json behind, so every build
# afterwards failed with "Package.swift … doesn't exist in file system" and
# could not recover on its own. ~/Library/Caches is not synced and not reaped
# on a timer.
DERIVED="$HOME/Library/Caches/yoman-ios-build"
mkdir -p "$DERIVED"

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
step() { printf '\n▸ %s\n' "$1"; }

if [ "${YOMAN_SKIP_BUILD:-0}" = 1 ]; then
  step "משתמש באתר שכבר נבנה"
else
  step "בונה את האתר"
  npm run build || { echo "✖ בניית האתר נכשלה" >&2; exit 1; }
fi

step "מעדכן את פרויקט ה-iOS"
npx cap sync ios || { echo "✖ עדכון פרויקט ה-iOS נכשל" >&2; exit 1; }

# The device names are collected as plain comma-separated strings rather than
# arrays. macOS ships bash 3.2, where expanding an empty array as "${a[@]}"
# under `set -u` aborts the script with "unbound variable" — and "no devices
# were skipped" is exactly the ordinary case that would trip it.
INSTALLED_LIST=""
SKIPPED_LIST=""
FAILED_LIST=""

append_to() {
  local current=$1 item=$2
  if [ -z "$current" ]; then printf '%s' "$item"; else printf '%s, %s' "$current" "$item"; fi
}

# Whether a device is still on the end of the cable. `ios-devices.py` is the one
# place that decides what "connected" means, so this asks it again rather than
# forming a second opinion.
still_reachable() {
  python3 "$(dirname "$0")/ios-devices.py" 2>/dev/null \
    | awk -F'\t' -v id="$1" '$1 == id && $2 == "ready" { found = 1 } END { exit !found }'
}

# Kept as well as shown. The reason a build failed is somewhere in xcodebuild's
# output, and the reasons that matter need opposite answers from the user — so
# the run is teed to a file the caller can ask questions of afterwards.
BUILD_LOG=$(mktemp -t yoman-build-log)

build_for() {
  xcodebuild \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration Debug \
    -destination "id=$1" \
    -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    build < /dev/null 2>&1 | tee "$BUILD_LOG"
  # tee's status is not the one that matters.
  return "${PIPESTATUS[0]}"
}

# A device that is plugged in but locked.
#
# It passes every readiness test there is — it is on the end of the cable and
# answering, so `ios-devices.py` calls it ready — but the developer disk image
# cannot be mounted on a locked device, and xcodebuild spends a full minute
# timing out on a destination that is never going to appear. Both devices failed
# this way on a push at 21:20 at night, and the summary said only "בנייה נכשלה",
# which sends you to read the code when the answer is the passcode.
device_is_locked() {
  grep -qi 'developer disk image could not be mounted' "$BUILD_LOG" ||
    grep -qi 'Timed out waiting for all destinations' "$BUILD_LOG"
}

# push-all.sh passes a path in and prints back what it finds there, so a partial
# install ("the phone got it, the iPad was skipped") is never reported as a
# clean success in the final summary.
write_status() {
  [ -n "${YOMAN_STATUS_FILE:-}" ] || return 0
  printf '%s\n' "$1" > "$YOMAN_STATUS_FILE"
}

# A few words for the one-line summary push-all.sh prints at the end.
short_reason() {
  case "$1" in
    gone)     printf 'לא מחובר' ;;
    unpaired) printf 'לא נתן אמון במחשב' ;;
    devmode)  printf 'מצב פיתוח כבוי' ;;
    asleep)   printf 'נעול או ישן' ;;
    *)        printf 'לא מוכן' ;;
  esac
}

# Why a device cannot take the app, and the one thing that fixes it.
explain() {
  case "$1" in
    gone)
      printf '     %s→ המכשיר מוכר למחשב אבל לא מחובר כרגע%s\n' "$YELLOW" "$OFF"
      printf '     %s  חבר אותו בכבל, או ודא שהוא ער ועל אותה רשת Wi-Fi%s\n' "$YELLOW" "$OFF"
      ;;
    unpaired)
      printf '     %s→ נעל ופתח את המכשיר ואשר "Trust This Computer" / "לתת אמון במחשב"%s\n' "$YELLOW" "$OFF"
      printf '     %s  (במכשיר חדש זה תמיד השלב הראשון)%s\n' "$YELLOW" "$OFF"
      ;;
    devmode)
      printf '     %s→ במכשיר: הגדרות ← פרטיות ואבטחה ← מצב פיתוח ← הדלק ← הפעל מחדש%s\n' "$YELLOW" "$OFF"
      ;;
    asleep)
      printf '     %s→ פתח את המכשיר (הזן קוד) והשאר אותו פתוח, ואז הרץ שוב%s\n' "$YELLOW" "$OFF"
      ;;
  esac
}

step "מחפש מכשירים"
DEVICE_LIST=$(mktemp -t yoman-device-list)
trap 'rm -f "$DEVICE_LIST" "$BUILD_LOG"' EXIT
python3 scripts/ios-devices.py > "$DEVICE_LIST" 2>/dev/null

# Read the whole list before looping: xcodebuild and devicectl run inside the
# loop and would otherwise eat the lines still waiting on stdin.
DEVICES=()
while IFS= read -r line; do
  [ -n "$line" ] && DEVICES+=("$line")
done < "$DEVICE_LIST"

if [ ${#DEVICES[@]} -eq 0 ]; then
  cat >&2 <<'EOS'

✖ לא נמצא אף אייפון או אייפד.

   • חבר את הכבל בשני הקצוות, ובדוק שזה כבל נתונים ולא כבל טעינה בלבד
   • פתח את המכשיר (הזן קוד) — כשהוא נעול הוא לא מזוהה
   • אם קופץ "Trust This Computer" / "לתת אמון במחשב" — אשר

EOS
  write_status "לא נמצא אף אייפון או אייפד מחובר"
  exit 1
fi

READY=()
SKIPPED=()
for entry in "${DEVICES[@]}"; do
  IFS=$'\t' read -r id state kind name <<< "$entry"
  if [ -n "${IOS_DEVICE_ID:-}" ] && [ "$id" != "$IOS_DEVICE_ID" ]; then
    continue
  fi
  if [ "$state" = ready ]; then
    printf '  %s✔%s %s (%s)\n' "$GREEN" "$OFF" "$name" "$kind"
    READY+=("$entry")
  else
    printf '  %s•%s %s (%s) — מדולג\n' "$YELLOW" "$OFF" "$name" "$kind"
    explain "$state"
    SKIPPED_LIST=$(append_to "$SKIPPED_LIST" "$name ($(short_reason "$state"))")
  fi
done

if [ ${#READY[@]} -eq 0 ]; then
  printf '\n%s✖ אף מכשיר לא מוכן להתקנה — ראה את ההסבר ליד כל מכשיר למעלה.%s\n' "$RED" "$OFF" >&2
  write_status "לא הותקן על אף מכשיר · דולג: ${SKIPPED_LIST:-אין מכשיר מוכן}"
  exit 1
fi

# The development team can come from three places, in order of reliability:
# an explicit override, the team already written into the Xcode project, or a
# certificate sitting in the keychain from a previous build.
TEAM_ID=${IOS_TEAM_ID:-}

if [ -z "$TEAM_ID" ]; then
  TEAM_ID=$(sed -nE 's/.*DEVELOPMENT_TEAM = ([A-Z0-9]{10});.*/\1/p' \
    ios/App/App.xcodeproj/project.pbxproj | head -1)
fi

if [ -z "$TEAM_ID" ]; then
  TEAM_ID=$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -nE 's/.*"Apple Development: .*\(([A-Z0-9]{10})\)".*/\1/p' | head -1)
fi

if [ -z "$TEAM_ID" ]; then
  cat >&2 <<'EOS'

✖ חסר "צוות פיתוח" (Development Team) — בחירה חד-פעמית ב-Xcode.

   Xcode נפתח עכשיו. צריך רק:
   1. בעמודה השמאלית ללחוץ על הפרויקט "App" (הכי למעלה)
   2. ללחוץ על הלשונית "Signing & Capabilities"
   3. בשורה "Team" לבחור מהתפריט: Mohamad Mahroum (Personal Team)
   4. לסגור את Xcode

   ואז להריץ שוב.

EOS
  open ios/App/App.xcodeproj 2>/dev/null || true
  exit 1
fi
printf '  צוות פיתוח: %s\n' "$TEAM_ID"

# The web assets are copied into the app bundle, so they must be clean too.
step "מנקה תגיות Finder מהקבצים"
xattr -cr dist ios "$DERIVED" 2>/dev/null || true

INSTALLED=()
FAILED=()

for entry in "${READY[@]}"; do
  IFS=$'\t' read -r id state kind name <<< "$entry"

  step "בונה עבור $name"
  # Built per device rather than once for all of them: with automatic signing a
  # new device has to be registered with the team, and that happens as part of a
  # build aimed at it. The derived-data folder is shared, so every build after
  # the first is incremental and mostly just re-signs.
  if ! build_for "$id"; then
    # A build only fails this way for two reasons, and they need opposite
    # answers, so ask which one before reporting anything. A device that went
    # away mid-run — the cable knocked out, the phone put down and locked —
    # takes xcodebuild all the way to "unable to find a destination", a page of
    # simulator names, and an exit code that looks exactly like a broken build.
    # Saying "בנייה נכשלה" for that sends the user to look at the code when the
    # answer is the cable.
    if ! still_reachable "$id"; then
      printf '   %s\n' "המכשיר התנתק באמצע — חבר אותו שוב והרץ שוב"
      FAILED+=("$name|התנתק באמצע ההתקנה")
      FAILED_LIST=$(append_to "$FAILED_LIST" "$name (התנתק)")
      continue
    fi

    # Still connected, so the build did not fail for want of a device — but a
    # locked one cannot mount the developer disk image, and no amount of
    # rebuilding changes that. Reported here rather than retried: the retry below
    # costs another minute per device and cannot succeed.
    if device_is_locked; then
      printf '   %s\n' "המכשיר נעול — פתח אותו (הזן קוד), השאר אותו פתוח, והרץ שוב"
      FAILED+=("$name|נעול — פתח את המכשיר והרץ שוב")
      FAILED_LIST=$(append_to "$FAILED_LIST" "$name (נעול)")
      continue
    fi

    # A Swift package checkout that has gone missing under the cache cannot be
    # repaired by xcodebuild: its workspace state still claims the package is
    # there, so resolution fails the same way every time. Throwing the checkouts
    # away costs one re-fetch and is the only thing that fixes it — worth trying
    # once before giving up on a device.
    printf '   %s\n' "מנקה חבילות Swift ומנסה שוב…"
    rm -rf "$DERIVED/SourcePackages"
    if ! build_for "$id"; then
      FAILED+=("$name|בנייה נכשלה")
      FAILED_LIST=$(append_to "$FAILED_LIST" "$name")
      continue
    fi
  fi

  APP_PATH=$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'App.app' -print -quit)
  if [ -z "$APP_PATH" ]; then
    FAILED+=("$name|לא נמצאה אפליקציה בנויה")
    FAILED_LIST=$(append_to "$FAILED_LIST" "$name")
    continue
  fi

  step "מתקין על $name"
  if ! xcrun devicectl device install app --device "$id" "$APP_PATH" < /dev/null; then
    FAILED+=("$name|ההתקנה נכשלה — נסה לחבר בכבל")
    FAILED_LIST=$(append_to "$FAILED_LIST" "$name")
    continue
  fi

  xcrun devicectl device process launch --device "$id" "$BUNDLE_ID" < /dev/null >/dev/null 2>&1 || true
  INSTALLED+=("$name")
  INSTALLED_LIST=$(append_to "$INSTALLED_LIST" "$name")
done

printf '\n'
if [ ${#INSTALLED[@]} -gt 0 ]; then
  printf '%s%s✔ הותקן על %d מכשירים:%s\n' "$GREEN" "$BOLD" "${#INSTALLED[@]}" "$OFF"
  for name in "${INSTALLED[@]}"; do printf '   • %s\n' "$name"; done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '%s%s✖ לא הצליח על:%s\n' "$RED" "$BOLD" "$OFF"
  for row in "${FAILED[@]}"; do printf '   • %s — %s\n' "${row%%|*}" "${row#*|}"; done
  cat >&2 <<'EOS'

   אם בשגיאות הופיעה המילה errSecInternalComponent — זו בקשת הרשאה של
   ה-Keychain שלא הצליחה לקפוץ מהטרמינל. הפתרון חד-פעמי:
   פותחים את Xcode, בוחרים את המכשיר למעלה, לוחצים ▶, וכשמבקש סיסמה
   (זו סיסמת המחשב) לוחצים "Always Allow".
EOS
fi

# The wording is assembled so the summary reads as the truth and nothing more:
# a skipped iPad or a failed device keeps the word "דולג"/"נכשל" in the line,
# which is what makes push-all.sh mark it as a warning rather than a tick.
if [ -n "$INSTALLED_LIST" ]; then
  STATUS="הותקן על: $INSTALLED_LIST"
else
  STATUS="לא הותקן על אף מכשיר"
fi
[ -n "$SKIPPED_LIST" ] && STATUS="$STATUS · דולג: $SKIPPED_LIST"
[ -n "$FAILED_LIST" ] && STATUS="$STATUS · נכשל: $FAILED_LIST"
write_status "$STATUS"

if [ ${#INSTALLED[@]} -eq 0 ]; then
  exit 1
fi

cat <<'EOS'

  בהפעלה הראשונה על מכשיר חדש iOS יבקש לאשר את המפתח:
  הגדרות ← כללי ← VPN וניהול מכשיר ← בחר את החשבון שלך ← Trust
EOS
