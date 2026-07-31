#!/bin/bash
#
# לחיצה כפולה: מפרסם את הגרסה העדכנית של האתר, ומדפיס את הכתובת שאפשר
# לפתוח בטלפון ולהוסיף למסך הבית.
#
# הנתונים של היומן לא עולים לאינטרנט — הם נשארים במכשיר.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

printf '\033[1m== פרסום יומן עבודה לאינטרנט ==\033[0m\n'

if bash scripts/deploy-pages.sh; then
  printf '\n\033[1mבטלפון:\033[0m פותחים את הכתובת ב-Safari ← כפתור השיתוף ← "הוסף למסך הבית"\n'
else
  printf '\n\033[31m\033[1m✖ הפרסום נכשל\033[0m\n'
fi

read -r -p $'\nלחץ Enter לסגירה… ' _
