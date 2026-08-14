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
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  ok "יש תעודת חתימה"
elif [ -d "$HOME/Library/Developer/Xcode/UserData" ]; then
  printf '%s•%s אין עדיין תעודת חתימה — היא נוצרת אוטומטית בבנייה הראשונה\n' "$YELLOW" "$OFF"
  todo 'אם הבנייה מתלוננת על Team: npm run ios:open ואז App ← Signing & Capabilities ← Team'
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
