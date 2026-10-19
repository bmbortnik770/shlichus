#!/usr/bin/env bash
# פריסת apps/web לאתר: build → העתקה ל-shlichus-new/app → commit → push → המתנה לפרסום
set -e
MSG="$1"
cd /c/Users/bmbor/shlichus-crm/apps/web
npx vite build 2>&1 | grep -E "built|rror"
rm -rf /c/Users/bmbor/shlichus-new/app && mkdir -p /c/Users/bmbor/shlichus-new/app && cp -r dist/. /c/Users/bmbor/shlichus-new/app/
JS=$(ls dist/assets | grep '^index-.*\.js$' | head -1)
cd /c/Users/bmbor/shlichus-new
git add -A app
git commit -q -m "deploy: app — $MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
for i in $(seq 1 50); do c=$(curl -s -o /dev/null -w "%{http_code}" "https://bmbortnik770.github.io/shlichus/app/assets/$JS"); [ "$c" = "200" ] && break; sleep 6; done
echo "live: $c ($JS) $(git log --oneline -1)"
