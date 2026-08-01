#!/bin/bash
#
# לחיצה כפולה: בודקת מה חסר כדי להתקין את האפליקציה על האייפון.
# לא בונה כלום — רק מדווחת.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

bash scripts/ios-check.sh

read -r -p $'\nלחץ Enter לסגירה… ' _
