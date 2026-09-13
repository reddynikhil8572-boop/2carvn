#!/usr/bin/env bash
# End-to-end walk through the Phase 1 flow against a running API.
#
# The vitest suite (npm test) covers the same ground faster and in more detail,
# but it runs with NODE_ENV=test, where rate limiters and secure-cookie flags
# are disabled. This script is what exercises the API as actually deployed:
#   docker compose up -d && npm run seed && bash scripts/e2e-check.sh
#
# Keep it for that reason. If it starts returning 429, that is the production
# rate limiter talking, not a regression in the flow.
set -u

API=${API:-http://localhost:5000/api/v1}
PASS=0; FAIL=0
jarA=$(mktemp); jarB=$(mktemp); jarS=$(mktemp)

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { if [ "$2" = "$3" ]; then printf '  PASS  %-52s %s\n' "$1" "$2"; PASS=$((PASS+1));
         else printf '  FAIL  %-52s got %s want %s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi }

code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
body() { cat /tmp/body.json; }

# Reads a field out of the last response's `data` object.
#
# The body is piped in rather than read by path: `node` here is the Windows
# build, which resolves the shell's /tmp to a Windows-drive path and finds
# nothing there.
field() { body | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const d = JSON.parse(raw).data || {};
      const v = process.argv[1].split(".").reduce((o, k) => (o == null ? o : o[k]), d);
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch { process.stdout.write(""); }
  });' "$1"; }

say "1. Platform owner authenticates (no school code)"
c=$(code -c "$jarS" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@edusphere.local","password":"ChangeMe!2026"}')
ok "super admin login" "$c" "200"

say "2. Owner provisions two schools, each with its first admin"
# §3 in one call. Until this endpoint existed the admins had to be inserted by
# a seed script, which meant the documented provisioning flow could not actually
# be completed through the API.
c=$(code -b "$jarS" -c "$jarS" -X POST "$API/super-admin/schools" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","name":"Alpha Academy","city":"New Delhi","plan":"STANDARD","admin":{"email":"admin@alpha.test","name":"Alpha Admin","password":"Passw0rd!x"}}')
ok "provision school A" "$c" "201"
SCHOOL_A=$(field "id")

c=$(code -b "$jarS" -X POST "$API/super-admin/schools" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-B","name":"Beta Institute","city":"Kolkata","plan":"BASIC","admin":{"email":"admin@beta.test","name":"Beta Admin","password":"Passw0rd!x"}}')
ok "provision school B" "$c" "201"

c=$(code -b "$jarS" -X POST "$API/super-admin/schools" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","name":"Duplicate","admin":{"email":"x@dup.test","name":"Dup","password":"Passw0rd!x"}}')
ok "duplicate school code rejected (P2002 -> 409)" "$c" "409"

# A school with no admin is a school nobody can log into.
c=$(code -b "$jarS" -X POST "$API/super-admin/schools" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-NOADMIN","name":"No Admin"}')
ok "school without an admin refused" "$c" "422"

# Omitting the password means the owner never handles the customer's credential:
# the account exists, cannot be signed into, and is sent a reset link.
c=$(code -b "$jarS" -X POST "$API/super-admin/schools" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-RESET","name":"Reset School","admin":{"email":"head@reset.test","name":"Reset Head"}}')
ok "provision without a password" "$c" "201"
MUSTRESET=$(field "adminMustResetPassword")
ok "  ...flags that a reset is required" "$MUSTRESET" "true"

c=$(code -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-RESET","email":"head@reset.test","password":"Passw0rd!x"}')
ok "  ...and that account cannot be guessed into" "$c" "401"

c=$(code -b "$jarS" "$API/super-admin/schools")
ok "owner lists schools" "$c" "200"

say "3. The provisioned admins log in — no seed script involved"
c=$(code -c "$jarA" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
ok "school A admin login" "$c" "200"

c=$(code -c "$jarB" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-B","email":"admin@beta.test","password":"Passw0rd!x"}')
ok "school B admin login" "$c" "200"

say "4. Same email, different schools — must be distinct identities"
c=$(code -b "$jarA" -X POST "$API/school-admin/users" -H 'Content-Type: application/json' \
  -d '{"email":"shared@student.test","password":"Passw0rd!x","name":"Alpha Student","role":"STUDENT"}')
ok "school A creates student" "$c" "201"

c=$(code -b "$jarB" -X POST "$API/school-admin/users" -H 'Content-Type: application/json' \
  -d '{"email":"shared@student.test","password":"Passw0rd!x","name":"Beta Student","role":"STUDENT"}')
ok "school B creates student with SAME email" "$c" "201"

say "5. Students log in against their own School Code"
c=$(code -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"shared@student.test","password":"Passw0rd!x"}')
ok "student logs in at school A" "$c" "200"
NAME_A=$(body | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
ok "  ...and resolves to the right person" "$NAME_A" "Alpha Student"

c=$(code -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-B","email":"shared@student.test","password":"Passw0rd!x"}')
NAME_B=$(body | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
ok "same email at school B is a different person" "$NAME_B" "Beta Student"

c=$(code -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-B","email":"shared@student.test","password":"WrongPass!1"}')
ok "wrong password rejected" "$c" "401"

say "6. Tenant isolation over HTTP"
LIST_A=$(curl -s -b "$jarA" "$API/school-admin/users")
LIST_B=$(curl -s -b "$jarB" "$API/school-admin/users")
echo "$LIST_A" | grep -q "Alpha Student" && a_sees_own=yes || a_sees_own=no
echo "$LIST_A" | grep -q "Beta Student"  && a_sees_other=yes || a_sees_other=no
ok "school A sees its own users" "$a_sees_own" "yes"
ok "school A does NOT see school B's users" "$a_sees_other" "no"
echo "$LIST_B" | grep -q "Alpha Student" && b_sees_other=yes || b_sees_other=no
ok "school B does NOT see school A's users" "$b_sees_other" "no"

say "7. Role enforcement"
c=$(code -b "$jarA" "$API/super-admin/schools")
ok "school admin cannot reach super-admin routes" "$c" "403"

c=$(code -b "$jarS" "$API/school-admin/users")
ok "super admin blocked from tenant-scoped route" "$c" "403"

c=$(code "$API/school-admin/users")
ok "anonymous request rejected" "$c" "401"

c=$(code -b "$jarA" -X POST "$API/school-admin/users" -H 'Content-Type: application/json' \
  -d '{"email":"x@y.test","password":"Passw0rd!x","name":"Sneaky","role":"SUPER_ADMIN"}')
ok "cannot create a SUPER_ADMIN via school-admin route" "$c" "422"

say "8. Session lifecycle"
c=$(code -b "$jarA" "$API/auth/me"); ok "me returns profile" "$c" "200"
c=$(code -b "$jarA" -c "$jarA" -X POST "$API/auth/refresh"); ok "refresh rotates session" "$c" "200"
c=$(code -b "$jarA" -c "$jarA" -X POST "$API/auth/logout"); ok "logout" "$c" "200"
c=$(code -b "$jarA" "$API/auth/me"); ok "me after logout is unauthorised" "$c" "401"

say "9. Two-factor authentication (§13)"
# Sign school A's admin back in — section 8 logged them out.
c=$(code -c "$jarA" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
ok "school A admin signs back in" "$c" "200"

c=$(code -b "$jarA" -X POST "$API/auth/2fa/setup")
ok "setup returns an otpauth URI" "$c" "200"
secret=$(field secret)

# The secret comes back in plaintext from /2fa/setup precisely so a client can
# show it for manual entry, which is what lets this script compute a code
# without reaching into the database for the encrypted copy.
totp() { npx --no-install ts-node scripts/totp-code.ts "$secret" "${1:-0}"; }

c=$(code -b "$jarA" -X POST "$API/auth/2fa/enable" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$(totp)\"}")
ok "enable with a live code" "$c" "200"
recovery=$(field recoveryCodes.0)

jar2=$(mktemp)
c=$(code -c "$jar2" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
ok "password alone still returns 200" "$c" "200"
ok "  ...but demands a second factor" "$(field twoFactorRequired)" "true"

# The point of the whole feature: no session cookie was set. Checked against
# the jar rather than the body, because that is what an attacker would use.
grep -q 'edusphere_at' "$jar2" && setcookie=yes || setcookie=no
ok "  ...and sets no session cookie" "$setcookie" "no"

challenge=$(field challengeToken)

c=$(code -c "$jar2" -X POST "$API/auth/2fa/verify" -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$challenge\",\"code\":\"000000\"}")
ok "wrong code rejected" "$c" "401"

# Recovery codes are the break-glass path, and the only one this script can
# exercise twice without waiting out a 30-second TOTP window.
c=$(code -c "$jar2" -X POST "$API/auth/2fa/verify" -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$challenge\",\"code\":\"$recovery\"}")
ok "recovery code completes the login" "$c" "200"

c=$(code -b "$jar2" "$API/auth/me"); ok "  ...and the session works" "$c" "200"

# A throwaway jar: `-c` without `-b` rewrites the file, and this login sets no
# cookies, so pointing it at $jar2 would quietly discard the session just
# established above.
jar3=$(mktemp)
c=$(code -c "$jar3" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
challenge=$(field challengeToken)
c=$(code -X POST "$API/auth/2fa/verify" -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$challenge\",\"code\":\"$recovery\"}")
ok "spent recovery code refused" "$c" "401"

c=$(code -b "$jar2" -X POST "$API/auth/2fa/disable" -H 'Content-Type: application/json' \
  -d '{"password":"Passw0rd!x"}')
ok "disable with the password" "$c" "200"

say "10. Course hierarchy (§6)"
# Runs before the password reset section, which changes admin A's password and
# revokes its sessions.
#
# The vitest suite covers the authorization rules in far more detail. What this
# adds is the production middleware chain: the routes are actually mounted, and
# they behave the same with the real rate limiters and secure-cookie flags in
# front of them.
jarC=$(mktemp)
c=$(code -c "$jarC" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
ok "school A admin signs in to author" "$c" "200"

c=$(code -b "$jarC" -X POST "$API/courses" -H 'Content-Type: application/json' \
  -d '{"title":"Algebra I","subject":"Maths"}')
ok "creates a course" "$c" "201"
COURSE=$(field "id")

c=$(code -b "$jarC" "$API/courses/$COURSE")
ok "course tree fetched" "$c" "200"
CHAPTER=$(field "modules.0.chapters.0.id")
[ -n "$CHAPTER" ] && has_default=yes || has_default=no
# §6 mandates four container levels; §4.3 says they must not cost four calls.
ok "  ...with a default module and chapter" "$has_default" "yes"

c=$(code -b "$jarC" -X POST "$API/chapters/$CHAPTER/lessons" -H 'Content-Type: application/json' \
  -d '{"title":"Linear equations"}')
ok "adds a lesson" "$c" "201"
LESSON=$(field "id")

c=$(code -b "$jarC" -X POST "$API/lessons/$LESSON/items" -H 'Content-Type: application/json' \
  -d '{"kind":"VIDEO","title":"Intro","provider":"YOUTUBE","externalUrl":"https://example.com/v","isPublished":true}')
ok "adds a video item" "$c" "201"
VIDEO=$(field "id")

c=$(code -b "$jarC" -X POST "$API/lessons/$LESSON/items" -H 'Content-Type: application/json' \
  -d '{"kind":"ASSIGNMENT","title":"Essay","isPublished":true,"maxPoints":20}')
ok "adds an assignment item" "$c" "201"
ASSIGN=$(field "id")

c=$(code -b "$jarC" -X POST "$API/lessons/$LESSON/items" -H 'Content-Type: application/json' \
  -d '{"kind":"PODCAST","title":"Nope"}')
ok "unknown item kind refused" "$c" "422"

# §12 — quiz authoring, attempts and grading.
c=$(code -b "$jarC" -X POST "$API/lessons/$LESSON/items" -H 'Content-Type: application/json' \
  -d '{"kind":"QUIZ","title":"Chapter test","isPublished":true,"passingScore":50,"maxAttempts":1}')
ok "adds a quiz item" "$c" "201"
QUIZ=$(field "id")

c=$(code -b "$jarC" -X POST "$API/items/$QUIZ/questions" -H 'Content-Type: application/json' \
  -d '{"prompt":"2 + 2?","points":1,"options":[{"text":"4","isCorrect":true},{"text":"5","isCorrect":false}]}')
ok "adds a question" "$c" "201"

# A question nobody can answer correctly would silently drag every score down.
c=$(code -b "$jarC" -X POST "$API/items/$QUIZ/questions" -H 'Content-Type: application/json' \
  -d '{"prompt":"No right answer","options":[{"text":"a","isCorrect":false},{"text":"b","isCorrect":false}]}')
ok "question with no correct option refused" "$c" "422"

c=$(code -b "$jarC" -X PATCH "$API/courses/$COURSE" -H 'Content-Type: application/json' \
  -d '{"status":"PUBLISHED"}')
ok "publishes the course" "$c" "200"

c=$(code -b "$jarB" "$API/courses/$COURSE")
ok "school B cannot read it by id" "$c" "404"

# A course reaches students through a class (§2). jarA is the school admin,
# who is the only role permitted to create classes and enrol students.
c=$(code -b "$jarA" -X POST "$API/classes" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Year 1","academicYear":"2026"}')
ok "school admin creates a class" "$c" "201"
CLASS_ID=$(field "id")

jarSt=$(mktemp)
code -c "$jarSt" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"shared@student.test","password":"Passw0rd!x"}' >/dev/null
code -b "$jarSt" "$API/auth/me" >/dev/null
STUDENT_ID=$(field "id")

c=$(code -b "$jarA" -X POST "$API/classes/$CLASS_ID/enrollments" -H 'Content-Type: application/json' \
  -d "{\"studentId\":\"$STUDENT_ID\"}")
ok "  ...and enrols the student" "$c" "201"

# A teacher may read the class list to attach a course, but not create one.
# jarC above is the school ADMIN, so this needs a genuine teacher account —
# checking the rule with an admin session would pass for the wrong reason.
c=$(code -b "$jarA" -X POST "$API/school-admin/users" -H 'Content-Type: application/json' \
  -d '{"email":"teacher@alpha.test","password":"Passw0rd!x","name":"Alpha Teacher","role":"TEACHER"}')
ok "school admin creates a teacher" "$c" "201"

jarTe=$(mktemp)
c=$(code -c "$jarTe" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"teacher@alpha.test","password":"Passw0rd!x"}')
ok "teacher signs in" "$c" "200"

c=$(code -b "$jarTe" -X POST "$API/classes" -H 'Content-Type: application/json' \
  -d '{"name":"Teacher made","academicYear":"2026"}')
ok "teachers cannot create classes" "$c" "403"

c=$(code -b "$jarTe" "$API/classes")
ok "  ...but can read them" "$c" "200"
rm -f "$jarTe"

c=$(code -b "$jarC" -X POST "$API/courses/$COURSE/classes" -H 'Content-Type: application/json' \
  -d "{\"classId\":\"$CLASS_ID\"}")
ok "assigns the course to a class" "$c" "201"

STUDENT_LIST=$(curl -s -b "$jarSt" "$API/courses")
echo "$STUDENT_LIST" | grep -q "$COURSE" && st_sees=yes || st_sees=no
ok "published, assigned course visible to the student" "$st_sees" "yes"

c=$(code -b "$jarSt" -X POST "$API/courses" -H 'Content-Type: application/json' -d '{"title":"Nope"}')
ok "student cannot author" "$c" "403"

# The most important assertion in this section. Under Prisma a careless
# `include` returns is_correct by default and looks reasonable in review, so
# this is checked against the SERIALISED body rather than a projection's shape
# — a projection that is right in principle and bypassed by one handler still
# ships the bug.
STUDENT_QUIZ=$(curl -s -b "$jarSt" "$API/items/$QUIZ/quiz")
# Assert the read SUCCEEDED first. A 404 body trivially contains no isCorrect,
# so without this the leak check below passes while proving nothing.
echo "$STUDENT_QUIZ" | grep -q '"prompt"' && got_quiz=yes || got_quiz=no
ok "student can open the quiz" "$got_quiz" "yes"
echo "$STUDENT_QUIZ" | grep -qi "iscorrect" && leaks=yes || leaks=no
ok "  ...with correct answers absent" "$leaks" "no"

STUDENT_TREE=$(curl -s -b "$jarSt" "$API/courses/$COURSE")
echo "$STUDENT_TREE" | grep -q '"prompt"' && got_tree=yes || got_tree=no
ok "student's course tree includes the quiz" "$got_tree" "yes"
echo "$STUDENT_TREE" | grep -qi "iscorrect" && tree_leaks=yes || tree_leaks=no
ok "  ...still with correct answers absent" "$tree_leaks" "no"

STAFF_QUIZ=$(curl -s -b "$jarC" "$API/items/$QUIZ/quiz")
echo "$STAFF_QUIZ" | grep -qi "iscorrect" && staff_sees=yes || staff_sees=no
ok "  ...but present for staff, who author them" "$staff_sees" "yes"

# The server stamps started_at and derives expires_at; the client never sends
# a time, which is what makes the limit real rather than decorative.
c=$(code -b "$jarSt" -X POST "$API/items/$QUIZ/attempts" -H 'Content-Type: application/json' -d '{}')
ok "student starts an attempt" "$c" "201"
ATTEMPT=$(field "id")
STARTED=$(field "startedAt")
[ -n "$STARTED" ] && server_timed=yes || server_timed=no
ok "  ...with a server-recorded start time" "$server_timed" "yes"

# maxAttempts is 1, so a second is refused.
c=$(code -b "$jarSt" -X POST "$API/attempts/$ATTEMPT/submit" -H 'Content-Type: application/json' \
  -d '{"answers":[],"integrityFlags":{"tabSwitches":3}}')
ok "submits and is graded server-side" "$c" "200"

c=$(code -b "$jarSt" -X POST "$API/attempts/$ATTEMPT/submit" -H 'Content-Type: application/json' \
  -d '{"answers":[]}')
ok "cannot submit the same attempt twice" "$c" "409"

c=$(code -b "$jarSt" -X POST "$API/items/$QUIZ/attempts" -H 'Content-Type: application/json' -d '{}')
ok "attempt limit enforced" "$c" "409"

# §12 assignments — text submission and manual grading.
c=$(code -b "$jarSt" -X POST "$API/items/$ASSIGN/submissions" -H 'Content-Type: application/json' \
  -d '{"bodyText":"My essay."}')
ok "student submits an assignment" "$c" "201"
SUBMISSION=$(field "id")
LATE=$(field "isLate")
ok "  ...with lateness decided by the server" "$LATE" "false"

# This assignment has allowsFile false, so a fileKey is refused on those
# grounds — it was a 501 until object storage landed. The upload path itself is
# exercised in §11.
c=$(code -b "$jarSt" -X POST "$API/items/$ASSIGN/submissions" -H 'Content-Type: application/json' \
  -d '{"bodyText":"With a file","fileKey":"uploads/essay.pdf"}')
ok "file attachment refused when the assignment forbids it" "$c" "400"

# maxPoints is 20.
c=$(code -b "$jarC" -X POST "$API/submissions/$SUBMISSION/grade" -H 'Content-Type: application/json' \
  -d '{"points":40}')
ok "mark above max_points refused" "$c" "400"

c=$(code -b "$jarC" -X POST "$API/submissions/$SUBMISSION/grade" -H 'Content-Type: application/json' \
  -d '{"points":17,"feedback":"Solid argument."}')
ok "teacher grades the submission" "$c" "200"

# Graded work is final; otherwise a student could replace the very work the
# mark refers to.
c=$(code -b "$jarSt" -X POST "$API/items/$ASSIGN/submissions" -H 'Content-Type: application/json' \
  -d '{"bodyText":"Sneaky rewrite."}')
ok "rewrite after grading refused" "$c" "409"

c=$(code -b "$jarSt" -X POST "$API/submissions/$SUBMISSION/grade" -H 'Content-Type: application/json' \
  -d '{"points":20}')
ok "student cannot grade their own work" "$c" "403"

# §7 video tracking. The only self-report in the product that cannot be moved
# to the server, so it is bounded instead — see services/video.service.ts.
c=$(code -b "$jarSt" -X POST "$API/items/$VIDEO/progress" -H 'Content-Type: application/json' \
  -d '{"positionSeconds":15,"watchedSecondsDelta":15,"intervalSeconds":15,"playbackRate":1,"device":"e2e"}')
ok "student reports video progress" "$c" "200"
FIRST=$(field "watchedSeconds")
ok "  ...and a plausible claim is credited" "$FIRST" "15"

# Claim an hour of viewing a second after the last heartbeat.
c=$(code -b "$jarSt" -X POST "$API/items/$VIDEO/progress" -H 'Content-Type: application/json' \
  -d '{"positionSeconds":3600,"watchedSecondsDelta":3600,"intervalSeconds":15}')
ok "an inflated claim is accepted" "$c" "200"
TOTAL=$(field "watchedSeconds")
# Only a second or two of real time passed, so the total must stay far below
# the 3615 a credulous implementation would record.
node -e "process.exit(Number(process.argv[1]) < 200 ? 0 : 1)" "$TOTAL" && clamped=yes || clamped=no
ok "  ...but clamped to real elapsed time" "$clamped" "yes"

c=$(code -b "$jarSt" -X POST "$API/items/$VIDEO/progress" -H 'Content-Type: application/json' \
  -d '{"positionSeconds":10,"watchedSecondsDelta":0,"occurredAt":"1970-01-01T00:00:00Z"}')
ok "client cannot state when the heartbeat happened" "$c" "422"

c=$(code -b "$jarC" "$API/items/$VIDEO/progress/all")
ok "staff see the class's progress" "$c" "200"

c=$(code -b "$jarSt" "$API/items/$VIDEO/progress/all")
ok "students do not" "$c" "403"

c=$(code -b "$jarC" "$API/courses/$COURSE/analytics/video")
ok "course video analytics for staff" "$c" "200"

c=$(code -b "$jarSt" "$API/courses/$COURSE/analytics/video")
ok "  ...not for students" "$c" "403"

say "11. Object storage"
# The bytes go straight from client to storage and never transit the API, so
# this section does what a browser does: presign, POST the form, confirm.

c=$(code -b "$jarC" -X POST "$API/items/$VIDEO/video/upload-url" -H 'Content-Type: application/json' \
  -d '{"contentType":"video/mp4"}')
ok "teacher gets a presigned upload" "$c" "200"
UP_KEY=$(field "key")
UP_URL=$(field "url")

# The server names every key: a client that could choose one could write into
# another school's prefix.
case "$UP_KEY" in
  schools/*/videos/*) keyed=yes ;;
  *) keyed=no ;;
esac
ok "  ...with a server-generated key under this school" "$keyed" "yes"

c=$(code -b "$jarC" -X POST "$API/items/$VIDEO/video/upload-url" -H 'Content-Type: application/json' \
  -d '{"contentType":"text/html"}')
ok "disallowed content type refused" "$c" "400"

# Confirming without uploading must not write the column — otherwise the row
# points at an object that does not exist.
c=$(code -b "$jarC" -X POST "$API/items/$VIDEO/video/confirm" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$UP_KEY\",\"durationSeconds\":600}")
ok "confirm refuses a file that was never uploaded" "$c" "400"

# Now actually upload, exactly as a browser would: the presigned fields as form
# parts, then the file.
printf 'fake mp4 payload' > /tmp/e2e-video.mp4
# Presign again: the earlier key is still valid, but the form fields have to be
# read from a response that has not been overwritten by the calls in between.
code -b "$jarC" -X POST "$API/items/$VIDEO/video/upload-url" -H 'Content-Type: application/json' \
  -d '{"contentType":"video/mp4"}' >/dev/null
UP_KEY=$(field "key")
UP_URL=$(field "url")
CURL_FIELDS=$(body | node -e '
  let raw=""; process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{
    const f=JSON.parse(raw).data.fields;
    console.log(Object.entries(f).map(([k,v])=>`-F ${k}=${v}`).join(" "));
  });')

# shellcheck disable=SC2086
UPLOAD_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UP_URL" $CURL_FIELDS -F "file=@/tmp/e2e-video.mp4")
node -e "process.exit(Number(process.argv[1]) < 300 ? 0 : 1)" "$UPLOAD_CODE" && uploaded=yes || uploaded=no
ok "the file uploads straight to storage" "$uploaded" "yes"

c=$(code -b "$jarC" -X POST "$API/items/$VIDEO/video/confirm" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$UP_KEY\",\"durationSeconds\":600}")
ok "confirm attaches it to the lesson item" "$c" "200"
PROVIDER=$(field "provider")
ok "  ...and switches the provider to UPLOAD" "$PROVIDER" "UPLOAD"

# The student can now fetch a signed URL and read the bytes back — the point of
# the whole exercise.
c=$(code -b "$jarSt" "$API/items/$VIDEO/video/url")
ok "student gets a playable URL" "$c" "200"
PLAY_URL=$(field "url")
echo "$PLAY_URL" | grep -q "X-Amz-Signature" && signed=yes || signed=no
ok "  ...which is signed, not public" "$signed" "yes"

BYTES=$(curl -s "$PLAY_URL")
[ "$BYTES" = "fake mp4 payload" ] && readback=yes || readback=no
ok "  ...and the bytes come back intact" "$readback" "yes"

# A student outside the course must not be able to mint a URL for its video.
c=$(code "$API/items/$VIDEO/video/url")
ok "anonymous request for a video URL rejected" "$c" "401"

rm -f /tmp/e2e-video.mp4

# §10 certificates. STUDENT_ID was resolved from the student's own session
# above. Guard the assertions below: an empty id would make the "no internal
# ids" grep match everything and pass while proving nothing.
[ -n "$STUDENT_ID" ] && got_student=yes || got_student=no
ok "resolved the student's own id" "$got_student" "yes"

c=$(code -b "$jarC" -X POST "$API/courses/$COURSE/certificates" -H 'Content-Type: application/json' \
  -d "{\"studentId\":\"$STUDENT_ID\"}")
ok "issues a certificate" "$c" "201"
SERIAL=$(field "serial")

# The verification endpoint takes NO session — that is the whole point of it.
c=$(code "$API/certificates/$SERIAL")
ok "a stranger can verify it with no session" "$c" "200"
VALID=$(field "valid")
ok "  ...and it reports as valid" "$VALID" "true"

# A verifier answers "is this real", not "show me the school".
VERIFY_BODY=$(curl -s "$API/certificates/$SERIAL")
echo "$VERIFY_BODY" | grep -q "$STUDENT_ID" && leaks_id=yes || leaks_id=no
ok "  ...without exposing internal ids" "$leaks_id" "no"
echo "$VERIFY_BODY" | grep -q "@" && leaks_email=yes || leaks_email=no
ok "  ...or any email address" "$leaks_email" "no"

c=$(code "$API/certificates/$SERIAL/download")
ok "renders the PDF on demand" "$c" "200"

c=$(code "$API/certificates/EDU-ZZZZ-ZZZZ-ZZZZ")
ok "unknown serial is a plain 404" "$c" "404"

c=$(code -b "$jarC" -X POST "$API/certificates/$SERIAL/revoke" -H 'Content-Type: application/json' \
  -d '{"reason":"Issued in error"}')
ok "staff revoke it" "$c" "200"

# Still resolves and says so — answering "no such certificate" would be a lie
# that works in the holder's favour.
c=$(code "$API/certificates/$SERIAL")
ok "revoked certificate still resolves" "$c" "200"
VALID=$(field "valid")
ok "  ...but reports as invalid" "$VALID" "false"

# Nothing was written to storage, so revocation bites immediately.
c=$(code "$API/certificates/$SERIAL/download")
ok "  ...and stops rendering" "$c" "410"

rm -f "$jarC" "$jarSt"

say "12. Password reset (§13)"
# Asserted against the mail sink's REST API, not against "the request returned
# 200". A reset flow that reports success while delivering nothing is exactly
# the failure this section exists to catch.
MAIL_API=${MAIL_API:-http://localhost:8025/api/v1}
curl -s -X DELETE "$MAIL_API/messages" >/dev/null

c=$(code -X POST "$API/auth/password/forgot" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test"}')
ok "reset requested" "$c" "200"

# Give SMTP a moment; the API sends before responding, but delivery to the sink
# is still a separate hop.
sleep 1
mail_count=$(curl -s "$MAIL_API/messages" | node -e '
  let raw=""; process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{try{const m=JSON.parse(raw);
    process.stdout.write(String((m.messages||[]).length));}catch{process.stdout.write("0");}});')
ok "  ...email actually delivered" "$mail_count" "1"

reset_token=$(curl -s "$MAIL_API/messages" | node -e '
  let raw=""; process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{try{
    const id=(JSON.parse(raw).messages||[])[0].ID;
    process.stdout.write(id);
  }catch{process.stdout.write("");}});')
reset_token=$(curl -s "$MAIL_API/message/$reset_token" | node -e '
  let raw=""; process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{try{
    const body=JSON.parse(raw).Text || "";
    const url=body.match(/https?:\/\/\S+/)[0];
    process.stdout.write(new URL(url).searchParams.get("token")||"");
  }catch{process.stdout.write("");}});')
[ -n "$reset_token" ] && got_token=yes || got_token=no
ok "  ...link contains a token" "$got_token" "yes"

# An unknown address must be indistinguishable in the response and must not
# generate mail.
curl -s -X DELETE "$MAIL_API/messages" >/dev/null
c=$(code -X POST "$API/auth/password/forgot" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"nobody@alpha.test"}')
ok "unknown address answers the same" "$c" "200"
sleep 1
mail_count=$(curl -s "$MAIL_API/messages" | node -e '
  let raw=""; process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{try{const m=JSON.parse(raw);
    process.stdout.write(String((m.messages||[]).length));}catch{process.stdout.write("0");}});')
ok "  ...and sends no mail" "$mail_count" "0"

c=$(code -X POST "$API/auth/password/reset" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$reset_token\",\"password\":\"N3wPassw0rd!\"}")
ok "reset completes" "$c" "200"

c=$(code -X POST "$API/auth/password/reset" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$reset_token\",\"password\":\"An0therPass!\"}")
ok "link cannot be reused" "$c" "400"

c=$(code -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"Passw0rd!x"}')
ok "old password rejected" "$c" "401"

jar4=$(mktemp)
c=$(code -c "$jar4" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"schoolCode":"E2E-A","email":"admin@alpha.test","password":"N3wPassw0rd!"}')
ok "new password works" "$c" "200"

rm -f "$jar4"
rm -f "$jar2" "$jar3"
rm -f "$jarA" "$jarB" "$jarS" /tmp/body.json
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
