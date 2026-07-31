#!/bin/bash
#
# לחיצה כפולה: בונה את האפליקציה ומתקינה על האייפון המחובר בכבל.
#
# פעם אחת בלבד, לפני השימוש הראשון:
#   Xcode ← Settings ← Accounts ← + ← Apple ID (חשבון רגיל, בחינם)

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

printf '\033[1m== התקנת יומן עבודה על האייפון ==\033[0m\n'

if bash scripts/ios-install.sh; then
  printf '\n\033[32m\033[1m✔ מוכן\033[0m\n'
else
  printf '\n\033[31m\033[1m✖ ההתקנה לא הושלמה\033[0m\n'
  printf 'ההודעה למעלה מסבירה מה חסר.\n'
fi

read -r -p $'\nלחץ Enter לסגירה… ' _
