#!/bin/bash
#
# Publishes the site by handing the work to GitHub.
#
#   npm run deploy
#
# The build itself happens in GitHub Actions (.github/workflows/deploy.yml), not
# here: pushing the commit is the whole job. That is what makes the web version
# keep itself current — every change that reaches `main` is rebuilt and
# republished without anyone remembering to do it.
#
# HTTPS is the part that matters. iOS only allows a web app to be installed to
# the home screen — and to work offline — from a secure origin, which is why the
# iPad can install the diary from here with no cable and no Xcode.
#
# The diary data is never published: it lives in the browser's storage on the
# device. Only the application itself is uploaded.

set -uo pipefail
cd "$(dirname "$0")/.."

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✖ התיקייה אינה מאגר git." >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  cat >&2 <<'EOS'
✖ אין remote בשם origin. צור קודם מאגר ב-GitHub:

    gh repo create yoman-avoda --public --source=. --remote=origin --push

EOS
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Anything not yet committed would simply not be published, and silently leaving
# a change behind is worse than committing it: this is a one-person project and
# the intent of running "publish" is unambiguous.
if [ -n "$(git status --porcelain)" ]; then
  echo "▸ שומר שינויים שלא נשמרו"
  git add -A
  git commit -q -m "עדכון $(date '+%Y-%m-%d %H:%M')" || true
fi

if [ -z "$(git log "origin/$BRANCH..$BRANCH" --oneline 2>/dev/null)" ] \
   && git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  echo "▸ אין שינויים חדשים לפרסום"
else
  echo "▸ שולח ל-GitHub"
  git push -q origin "$BRANCH" || {
    printf '%s✖ הדחיפה ל-GitHub נכשלה%s\n' "$RED" "$OFF" >&2
    exit 1
  }
fi

REPO=$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/([^/.]+)(\.git)?$#\1/\2#')
USER=${REPO%%/*}
NAME=${REPO##*/}
SITE="https://$(echo "$USER" | tr '[:upper:]' '[:lower:]').github.io/${NAME}/"

printf '\n%s%s✔ נשלח — GitHub בונה את האתר עכשיו%s\n' "$GREEN" "$BOLD" "$OFF"
printf '  הכתובת שלך: %s\n' "$SITE"
printf '  %s(הבנייה נמשכת דקה בערך; מעקב: gh run watch)%s\n' "$YELLOW" "$OFF"
