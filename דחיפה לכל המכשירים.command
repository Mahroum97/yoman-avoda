#!/bin/bash
#
# לחיצה כפולה: בונה את היומן ודוחף אותו לכל המקומות —
# אפליקציית ה-Mac, האייפון, האייפד, והאתר באינטרנט.
#
# מה שלא מוכן פשוט מדולג, והסיכום בסוף אומר בדיוק מה הגיע לאן.

cd "$(dirname "$0")" || exit 1

# On a double-click the shell starts without the usual PATH, so node installed
# by Homebrew or nvm is not found. Add the usual places before anything else.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  printf '\033[31m\033[1m✖ לא נמצא Node.js במחשב.\033[0m\n'
  printf 'יש להתקין אותו מ-nodejs.org ולנסות שוב.\n'
  read -r -p $'\nלחץ Enter לסגירה… ' _
  exit 1
fi

bash scripts/push-all.sh

printf '\nהחלון יישאר פתוח כדי שאפשר יהיה לקרוא את הסיכום.\n'
read -r -p $'לחץ Enter לסגירה… ' _
