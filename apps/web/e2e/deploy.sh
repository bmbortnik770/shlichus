#!/usr/bin/env bash
# פריסת apps/web לאתר: build → העתקה ל-shlichus-new/app → commit → push → המתנה לפרסום
set -e
MSG="$1"
# שער: לא מפרסמים אם בדיקה אחת נכשלת
cd /c/Users/bmbor/shlichus-crm/packages/core
npx vitest run > /tmp/shl-tests.log 2>&1 || { grep -E "×|FAIL|Tests " /tmp/shl-tests.log | head -20; echo "בדיקות הליבה נכשלו — לא מפרסמים"; exit 1; }
grep -E "Tests " /tmp/shl-tests.log
npx tsc --noEmit || { echo "שגיאת טיפוסים בליבה — לא מפרסמים"; exit 1; }
(cd ../../apps/crm && npx tsc --noEmit) || { echo "v2 לא מתקמפלת — לא מפרסמים"; exit 1; }
cd /c/Users/bmbor/shlichus-crm/apps/web
npx tsc --noEmit || { echo "שגיאת טיפוסים בממשק — לא מפרסמים"; exit 1; }
npx vite build 2>&1 | grep -E "built|rror"
rm -rf /c/Users/bmbor/shlichus-new/app && mkdir -p /c/Users/bmbor/shlichus-new/app && cp -r dist/. /c/Users/bmbor/shlichus-new/app/
JS=$(ls dist/assets | grep '^index-.*\.js$' | head -1)
cd /c/Users/bmbor/shlichus-new
git add -A app
git commit -q -m "deploy: app — $MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
# הרשת לפעמים נופלת — עד 3 ניסיונות
for t in 1 2 3; do git push -q origin main && break; echo "push נכשל, מנסה שוב ($t)"; sleep 5; done
for i in $(seq 1 50); do c=$(curl -s -o /dev/null -w "%{http_code}" "https://bmbortnik770.github.io/shlichus/app/assets/$JS"); [ "$c" = "200" ] && break; sleep 6; done
echo "live: $c ($JS) $(git log --oneline -1)"
