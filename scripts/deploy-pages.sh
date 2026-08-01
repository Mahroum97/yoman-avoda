#!/bin/bash
#
# Publishes the built site to the `gh-pages` branch, which GitHub serves over
# HTTPS. HTTPS is the part that matters: iOS only allows a web app to be
# installed to the home screen — and to work offline — from a secure origin.
#
#   npm run deploy
#
# The diary data is never published: it lives in the browser's storage on the
# device. Only the application itself is uploaded.

set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH=gh-pages
WORKTREE=tmp/pages

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "✖ אין remote בשם origin. צור קודם מאגר ב-GitHub." >&2
  exit 1
fi

if [ "${YOMAN_SKIP_BUILD:-0}" = 1 ]; then
  echo "▸ משתמש באתר שכבר נבנה"
else
  echo "▸ בונה את האתר"
  npm run build
fi

echo "▸ מכין את ענף $BRANCH"
rm -rf "$WORKTREE"
git worktree prune
if git show-ref --quiet "refs/heads/$BRANCH"; then
  git worktree add -q "$WORKTREE" "$BRANCH"
else
  git worktree add -q --detach "$WORKTREE"
  git -C "$WORKTREE" checkout -q --orphan "$BRANCH"
  git -C "$WORKTREE" rm -rqf . 2>/dev/null || true
fi

# Replace the published files wholesale so deleted assets do not linger.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. "$WORKTREE"/
# Tells GitHub Pages not to run the files through Jekyll, which would hide
# anything starting with an underscore.
touch "$WORKTREE/.nojekyll"

git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "▸ אין שינויים לפרסום"
else
  git -C "$WORKTREE" commit -q -m "deploy $(date '+%Y-%m-%d %H:%M')"
  git -C "$WORKTREE" push -q origin "$BRANCH"
  echo "▸ פורסם"
fi

git worktree remove --force "$WORKTREE"

REPO=$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/([^/.]+)(\.git)?$#\1/\2#')
USER=${REPO%%/*}
NAME=${REPO##*/}
echo
echo "✔ הכתובת שלך: https://${USER}.github.io/${NAME}/"
echo "  (ייתכן שיעברו דקה-שתיים עד שהיא תעלה בפעם הראשונה)"
