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

# 2 — the phone
DEVICE_JSON=$(mktemp -t yoman-check)
xcrun devicectl list devices --json-output "$DEVICE_JSON" >/dev/null 2>&1 || true

STATE=$(python3 - "$DEVICE_JSON" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    print("none|||"); raise SystemExit

for device in data.get("result", {}).get("devices", []):
    if device.get("hardwareProperties", {}).get("platform") != "iOS":
        continue
    connection = device.get("connectionProperties", {})
    properties = device.get("deviceProperties", {})
    mode = properties.get("developerModeStatus") or "unknown"
    paired = connection.get("pairingState") or "unknown"
    name = properties.get("name") or "iPhone"
    state = "ready" if (mode == "enabled" and paired == "paired") else (
        "devmode" if mode != "enabled" else "unpaired")
    print(f"{state}|{name}|{mode}|{paired}")
    break
else:
    print("none|||")
PY
)
rm -f "$DEVICE_JSON"

IFS='|' read -r PHONE_STATE PHONE_NAME PHONE_MODE PHONE_PAIR <<EOF
$STATE
EOF

case "$PHONE_STATE" in
  ready)
    ok "האייפון מחובר ומוכן ($PHONE_NAME)"
    ;;
  devmode)
    bad "האייפון מחובר ($PHONE_NAME) אבל מצב פיתוח כבוי — מצב: $PHONE_MODE"
    todo 'בטלפון: הגדרות ← פרטיות ואבטחה ← מצב פיתוח ← הדלק ← הפעל מחדש'
    READY=0
    ;;
  unpaired)
    bad "האייפון מחובר ($PHONE_NAME) אבל לא מקושר למחשב — מצב: $PHONE_PAIR"
    todo 'נעל ופתח את הטלפון ואשר "Trust This Computer"'
    READY=0
    ;;
  *)
    bad "לא נמצא אייפון מחובר"
    todo 'חבר את הכבל לשתי הקצוות ובדוק שהוא כבל נתונים (לא כבל טעינה בלבד)'
    todo 'פתח את הטלפון (הזן קוד) — כשהוא נעול הוא לא מזוהה'
    todo 'אם קופץ "Trust This Computer" / "לתת אמון" — אשר'
    READY=0
    ;;
esac

# 3 — signing
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  ok "יש תעודת חתימה"
elif [ -d "$HOME/Library/Developer/Xcode/UserData" ]; then
  printf '%s•%s אין עדיין תעודת חתימה — היא נוצרת אוטומטית בבנייה הראשונה\n' "$YELLOW" "$OFF"
  todo 'אם הבנייה מתלוננת על Team: npm run ios:open ואז App ← Signing & Capabilities ← Team'
fi

printf '\n'
if [ "$READY" = 1 ]; then
  printf '%s%s✔ הכול מוכן — אפשר להריץ "התקנה לאייפון.command"%s\n' "$GREEN" "$BOLD" "$OFF"
else
  printf '%s%sעדיין חסר משהו — ראה למעלה%s\n' "$YELLOW" "$BOLD" "$OFF"
fi
