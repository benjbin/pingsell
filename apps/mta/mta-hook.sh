#!/bin/sh
# Postfix pipe transport: every email received for MAIL_DOMAIN (bounces, complaints, postmaster…)
# arrives on stdin and is forwarded raw to the API. Exit 75 (EX_TEMPFAIL) = Postfix retries later.
# Usage (from master.cf): mta-hook <recipient>

. /etc/pingsell-hook.env

rcpt=$(printf '%s' "$1" | sed 's/%/%25/g; s/+/%2B/g; s/@/%40/g; s/ /%20/g')

/usr/bin/curl -sS -f -m 30 -X POST \
  -H "Content-Type: message/rfc822" \
  -H "X-Pingsell-Secret: ${HOOK_SECRET}" \
  --data-binary @- \
  "${HOOK_URL}?rcpt=${rcpt}" >/dev/null || exit 75

exit 0
