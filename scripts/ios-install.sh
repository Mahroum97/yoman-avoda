#!/bin/bash
#
# Builds the iPhone app and installs it on the connected device.
#
#   npm run ios:run
#
# Signing is the one part this cannot do on its own: iOS refuses to run an
# unsigned app. Add an Apple ID once in Xcode → Settings → Accounts, and this
# script picks up the team automatically from then on.

set -euo pipefail
cd "$(dirname "$0")/.."

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
BUNDLE_ID=com.mahroum.yoman
DERIVED=tmp/ios-build

step() { printf '\n▸ %s\n' "$1"; }

step "בונה את האתר ומעדכן את פרויקט ה-iOS"
npm run build
npx cap sync ios

step "מחפש את הטלפון"
# devicectl prints a human-readable table to stdout as well, so the JSON has to
# go to a file of its own — parsing stdout mixes the two and finds nothing.
DEVICE_JSON=$(mktemp -t yoman-devices)
xcrun devicectl list devices --json-output "$DEVICE_JSON" >/dev/null 2>&1 || true

read -r DEVICE_ID DEVICE_STATE <<EOF
$(python3 - "$DEVICE_JSON" <<'PYEOF'
import json, sys

try:
    with open(sys.argv[1]) as handle:
        data = json.load(handle)
except Exception:
    print(" none")
    raise SystemExit

for device in data.get("result", {}).get("devices", []):
    if device.get("hardwareProperties", {}).get("platform") != "iOS":
        continue
    connection = device.get("connectionProperties", {})
    properties = device.get("deviceProperties", {})
    dev_mode = properties.get("developerModeStatus")

    if dev_mode in (None, "disabled"):
        state = "devmode"
    elif connection.get("pairingState") != "paired":
        state = "unpaired"
    else:
        state = "ready"
    print(device["identifier"], state)
    break
else:
    print(" none")
PYEOF
)
EOF
rm -f "$DEVICE_JSON"

case "${DEVICE_STATE:-none}" in
  ready)
    echo "  נמצא: $DEVICE_ID"
    ;;
  devmode)
    cat >&2 <<'EOS'

✖ הטלפון מחובר, אבל "מצב פיתוח" כבוי — ובלי זה iOS לא מרשה להתקין אפליקציה.

   בטלפון:
   1. הגדרות ← פרטיות ואבטחה
   2. גוללים למטה ל-"מצב פיתוח" (Developer Mode) ← מדליקים
   3. הטלפון יבקש להפעיל מחדש — מאשרים
   4. אחרי ההפעלה מחדש, מאשרים את החלון "להפעיל מצב פיתוח?"

   אם "מצב פיתוח" לא מופיע בכלל: משאירים את הטלפון מחובר בכבל,
   מריצים את הסקריפט פעם אחת, ואז הוא יופיע בהגדרות.

EOS
    exit 1
    ;;
  unpaired)
    cat >&2 <<'EOS'

✖ הטלפון מחובר אבל עדיין לא מקושר למחשב הזה.

   נעל ופתח את הטלפון, ואשר את החלון "Trust This Computer" / "לתת אמון במחשב",
   ואז הרץ שוב.

EOS
    exit 1
    ;;
  *)
    echo "✖ לא נמצא אייפון מחובר. חבר את הטלפון בכבל, פתח אותו, ואשר \"Trust This Computer\"." >&2
    exit 1
    ;;
esac

# The development team is whatever certificate is already in the keychain.
TEAM_ID=${IOS_TEAM_ID:-$(security find-identity -v -p codesigning 2>/dev/null \
  | sed -nE 's/.*"Apple Development: .*\(([A-Z0-9]{10})\)".*/\1/p' | head -1)}

if [ -z "$TEAM_ID" ]; then
  cat >&2 <<'EOS'

✖ אין עדיין חשבון מפתח ב-Xcode, ובלי זה iOS לא מרשה להתקין אפליקציה.

   פעם אחת בלבד:
   1. פותחים את Xcode
   2. Xcode ← Settings ← Accounts ← + ← Apple ID
   3. מתחברים עם ה-Apple ID הרגיל שלך (חינם, לא צריך תוכנית מפתחים בתשלום)

   אחר כך מריצים שוב:  npm run ios:run
EOS
  exit 1
fi
echo "  צוות פיתוח: $TEAM_ID"

step "בונה את האפליקציה"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  build

APP_PATH=$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'App.app' -print -quit)
[ -n "$APP_PATH" ] || { echo "✖ הבנייה לא יצרה App.app" >&2; exit 1; }

step "מתקין על הטלפון"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

step "מפעיל"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" || true

cat <<'EOS'

✔ האפליקציה הותקנה על הטלפון.

  בהפעלה הראשונה iOS יבקש לאשר את המפתח:
  הגדרות ← כללי ← VPN וניהול מכשיר ← בחר את החשבון שלך ← Trust
EOS
