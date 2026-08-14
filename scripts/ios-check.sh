#!/bin/bash
#
# Reports, in plain language, what still stands between the project and an app
# on the phone. Cheap to run — it builds nothing.

cd "$(dirname "$0")/.." || exit 1
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
ok()   { printf '%s✔%s %s\n' "$GREEN" "$OFF" "$1"; }
bad()  { printf '%s✖%s %s\n' "$RED" "$OFF" "$1"; }
todo() { printf '   %s→ %s%s\n' "$YELLOW" "$1" "$OFF"; }

printf '%s== בדיקת מוכנות להתקנה על האייפון ==%s\n\n' "$BOLD" "$OFF"
READY=1

# 1 — Xcode
if xcodebuild -version >/dev/null 2>&1; then
  ok "Xcode מותקן ($(xcodebuild -version | head -1))"
else
  bad "Xcode לא זמין"; READY=0
fi

# 2 — the devices
#
# Every connected iPhone and iPad is reported, not just the first one found.
# With a phone and an iPad plugged in together, stopping at the first would hide
# a working device behind an unready one — and which of the two enumerates first
# is not something the Mac decides consistently.
DEVICE_LIST=$(mktemp -t yoman-check)
python3 "$(dirname "$0")/ios-devices.py" > "$DEVICE_LIST" 2>/dev/null

DEVICES=()
while IFS= read -r line; do
  [ -n "$line" ] && DEVICES+=("$line")
done < "$DEVICE_LIST"
rm -f "$DEVICE_LIST"

if [ ${#DEVICES[@]} -eq 0 ]; then
  bad "לא נמצא אף אייפון או אייפד מחובר"
  todo 'חבר את הכבל לשתי הקצוות ובדוק שהוא כבל נתונים (לא כבל טעינה בלבד)'
  todo 'פתח את המכשיר (הזן קוד) — כשהוא נעול הוא לא מזוהה'
  todo 'אם קופץ "Trust This Computer" / "לתת אמון" — אשר'
  READY=0
else
  ANY_READY=0
  for entry in "${DEVICES[@]}"; do
    IFS=$'\t' read -r _id state kind name <<< "$entry"
    case "$state" in
      ready)
        ok "$name ($kind) — מחובר ומוכן"
        ANY_READY=1
        ;;
      devmode)
        bad "$name ($kind) — מחובר אבל מצב פיתוח כבוי"
        todo 'במכשיר: הגדרות ← פרטיות ואבטחה ← מצב פיתוח ← הדלק ← הפעל מחדש'
        ;;
      asleep)
        bad "$name ($kind) — מחובר אבל ישן או נעול"
        todo 'פתח את המכשיר (הזן קוד) והשאר אותו פתוח'
        ;;
      gone)
        bad "$name ($kind) — מוכר למחשב אבל לא מחובר כרגע"
        todo 'חבר אותו בכבל, או ודא שהוא ער ועל אותה רשת Wi-Fi כמו המחשב'
        ;;
      unpaired)
        bad "$name ($kind) — מחובר אבל עדיין לא נתן אמון במחשב הזה"
        todo 'נעל ופתח את המכשיר ואשר "Trust This Computer" / "לתת אמון במחשב"'
        todo 'במכשיר חדש זה תמיד השלב הראשון — מצב פיתוח מופיע רק אחריו'
        ;;
    esac
  done
  [ "$ANY_READY" = 1 ] || READY=0
fi

# 3 — signing
#
# What actually matters is whether a valid profile exists and when it runs out,
# not where Xcode decided to keep it this year. Xcode 16 moved them out of
# ~/Library/MobileDevice into its own UserData folder, and a check that only
# knew the old path reported "0 profiles" on a machine that had just built and
# installed successfully — a false alarm that would have sent the user to add an
# Apple ID account that was already there. Both paths are searched now.
#
# The expiry is the useful part. A free account signs for seven days, and the
# app going dead on the phone with no warning is what started all of this.
PROFILE_DIRS=(
  "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  "$HOME/Library/MobileDevice/Provisioning Profiles"
)
NEWEST_PROFILE=""
for dir in "${PROFILE_DIRS[@]}"; do
  for f in "$dir"/*.mobileprovision; do
    [ -e "$f" ] || continue
    if [ -z "$NEWEST_PROFILE" ] || [ "$f" -nt "$NEWEST_PROFILE" ]; then
      NEWEST_PROFILE="$f"
    fi
  done
done

if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  ok "יש תעודת חתימה"
else
  bad "אין תעודת חתימה"
  todo 'פותחים Xcode ← תפריט Xcode ← Settings ← Accounts ← + ← Apple ID ומתחברים'
  READY=0
fi

if [ -n "$NEWEST_PROFILE" ]; then
  EXPIRES=$(security cms -D -i "$NEWEST_PROFILE" 2>/dev/null \
    | plutil -extract ExpirationDate raw -o - - 2>/dev/null | cut -dT -f1)
  DEVICES=$(security cms -D -i "$NEWEST_PROFILE" 2>/dev/null \
    | plutil -extract ProvisionedDevices raw -o - - 2>/dev/null | head -1)
  if [ -n "$EXPIRES" ]; then
    LEFT=$(( ( $(date -j -f "%Y-%m-%d" "$EXPIRES" "+%s" 2>/dev/null) - $(date "+%s") ) / 86400 ))
    if [ "$LEFT" -le 2 ] 2>/dev/null; then
      printf '%s•%s החתימה פגה בעוד %s ימים (%s) — הרץ התקנה כדי לחדש\n' "$YELLOW" "$OFF" "$LEFT" "$EXPIRES"
    else
      ok "החתימה תקפה עוד $LEFT ימים (עד $EXPIRES)${DEVICES:+, ל-$DEVICES מכשירים}"
    fi
  fi
else
  printf '%s•%s אין עדיין פרופיל חתימה — הוא ייווצר בבנייה הראשונה\n' "$YELLOW" "$OFF"
  printf '     %s  אם הבנייה נכשלת על "No Accounts": Xcode ← Settings ← Accounts ← + ← Apple ID%s\n' "$YELLOW" "$OFF"
fi

printf '\n'
if [ "$READY" = 1 ]; then
  printf '%s%s✔ הכול מוכן — אפשר להריץ "דחיפה לכל המכשירים.command"%s\n' "$GREEN" "$BOLD" "$OFF"
  # The one thing this check cannot see. A locked device answers everything asked
  # of it here and then refuses to mount the developer disk image, so the install
  # fails a minute later for a reason nothing up to this point hinted at.
  printf '%s  השאר את המכשירים פתוחים (לא נעולים) בזמן ההתקנה%s\n' "$YELLOW" "$OFF"
else
  printf '%s%sעדיין חסר משהו — ראה למעלה%s\n' "$YELLOW" "$BOLD" "$OFF"
fi
