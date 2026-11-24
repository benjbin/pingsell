#!/bin/sh
# Configures Postfix + OpenDKIM from the environment, then runs Postfix in the foreground.
set -eu

: "${MAIL_DOMAIN:?MAIL_DOMAIN est requis, ex. pingsell.neokrome.tech}"
: "${MTA_WEBHOOK_SECRET:?MTA_WEBHOOK_SECRET est requis, le meme que cote API}"
MAIL_HOSTNAME="${MAIL_HOSTNAME:-mail.${MAIL_DOMAIN}}"
DKIM_SELECTOR="${DKIM_SELECTOR:-pingsell}"
MTA_WEBHOOK_URL="${MTA_WEBHOOK_URL:-http://api:4000/webhooks/mta}"
# Networks allowed to hand mail over on the internal port 2525 (the API container).
INTERNAL_NETWORKS="${INTERNAL_NETWORKS:-127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16}"

# --- DKIM key (generated once, then kept in the /data volume) ---------------------------
mkdir -p /data/dkim /data/tls /run/opendkim
if [ ! -f "/data/dkim/${DKIM_SELECTOR}.private" ]; then
  echo "[mta] génération de la clé DKIM ${DKIM_SELECTOR} pour ${MAIL_DOMAIN}"
  opendkim-genkey -b 2048 -h sha256 -d "${MAIL_DOMAIN}" -s "${DKIM_SELECTOR}" -D /data/dkim
fi
chown -R opendkim:opendkim /data/dkim /run/opendkim
chmod 600 "/data/dkim/${DKIM_SELECTOR}.private"

# --- TLS certificate for STARTTLS (self-signed is fine between mail servers) ------------
if [ ! -f /data/tls/cert.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${MAIL_HOSTNAME}" \
    -keyout /data/tls/key.pem -out /data/tls/cert.pem >/dev/null 2>&1
  chmod 600 /data/tls/key.pem
fi

# --- OpenDKIM: sign every message from the API whose From is on MAIL_DOMAIN ---------------
printf '%s\n' ${INTERNAL_NETWORKS} > /etc/opendkim/internal
cat > /etc/opendkim/opendkim.conf <<EOF
Syslog                  no
Mode                    s
Domain                  ${MAIL_DOMAIN}
Selector                ${DKIM_SELECTOR}
KeyFile                 /data/dkim/${DKIM_SELECTOR}.private
Canonicalization        relaxed/relaxed
SignatureAlgorithm      rsa-sha256
OversignHeaders         From
InternalHosts           refile:/etc/opendkim/internal
Socket                  inet:8891@127.0.0.1
UserID                  opendkim
PidFile                 /run/opendkim/opendkim.pid
EOF

# --- Bounce hook settings (Postfix gives pipes an empty environment) ----------------------
cat > /etc/pingsell-hook.env <<EOF
HOOK_URL='${MTA_WEBHOOK_URL}'
HOOK_SECRET='${MTA_WEBHOOK_SECRET}'
EOF
chown root:nobody /etc/pingsell-hook.env
chmod 640 /etc/pingsell-hook.env

# --- Postfix ------------------------------------------------------------------------------
# Deliverability: each mailbox provider gets a few connections at a time, and a provider that answers
# "slow down" (4xx) is retried later with a growing delay instead of being hammered.
MICROSOFT_MAP=""
for d in outlook.com outlook.fr hotmail.com hotmail.fr hotmail.co.uk live.com live.fr msn.com; do
  MICROSOFT_MAP="${MICROSOFT_MAP:+${MICROSOFT_MAP}, }${d}=slow:"
done

postconf -e \
  "myhostname = ${MAIL_HOSTNAME}" \
  "mydomain = ${MAIL_DOMAIN}" \
  "myorigin = ${MAIL_DOMAIN}" \
  "smtpd_banner = ${MAIL_HOSTNAME} ESMTP" \
  "smtp_helo_name = ${MAIL_HOSTNAME}" \
  "inet_interfaces = all" \
  "inet_protocols = ipv4" \
  "compatibility_level = 3.6" \
  "maillog_file = /dev/stdout" \
  "mydestination =" \
  "local_recipient_maps =" \
  "local_transport = error:local delivery is disabled" \
  "alias_maps =" \
  "mynetworks = ${INTERNAL_NETWORKS}" \
  "relay_domains = ${MAIL_DOMAIN}" \
  "transport_maps = inline:{ ${MAIL_DOMAIN}=pingsell-hook:, ${MICROSOFT_MAP} }" \
  "pingsell-hook_destination_recipient_limit = 1" \
  "recipient_delimiter = +" \
  "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination" \
  "smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination" \
  "smtpd_helo_required = yes" \
  "disable_vrfy_command = yes" \
  "message_size_limit = 20480000" \
  "smtpd_tls_security_level = may" \
  "smtpd_tls_cert_file = /data/tls/cert.pem" \
  "smtpd_tls_key_file = /data/tls/key.pem" \
  "smtp_tls_security_level = may" \
  "smtp_tls_loglevel = 1" \
  "smtpd_milters = inet:127.0.0.1:8891" \
  "non_smtpd_milters = inet:127.0.0.1:8891" \
  "milter_default_action = accept" \
  "maximal_queue_lifetime = 2d" \
  "bounce_queue_lifetime = 1d" \
  "default_destination_concurrency_limit = 5" \
  "smtp_destination_concurrency_limit = 5" \
  "smtp_destination_concurrency_failed_cohort_limit = 10" \
  "minimal_backoff_time = 5m" \
  "maximal_backoff_time = 1h" \
  "queue_run_delay = 5m" \
  "slow_destination_concurrency_limit = 2" \
  "slow_destination_rate_delay = 0" \
  "slow_destination_concurrency_failed_cohort_limit = 10"

# Microsoft (Outlook, Hotmail, Live) is the strictest with new senders: fewer connections at once.
postconf -M "slow/unix=slow unix - - n - - smtp"

# Public port 25: inbound mail for MAIL_DOMAIN only. Never relays, whatever the source IP
# (behind Docker's port publishing every client could look "internal").
postconf -P \
  "smtp/inet/mynetworks=127.0.0.1/32" \
  "smtp/inet/smtpd_relay_restrictions=reject_unauth_destination" \
  "smtp/inet/smtpd_recipient_restrictions=reject_unauth_destination" \
  "smtp/inet/smtpd_milters="

# Internal port 2525: the API hands outgoing mail over here (not published on the host).
postconf -M "2525/inet=2525 inet n - n - - smtpd"
postconf -P \
  "2525/inet/syslog_name=postfix/api" \
  "2525/inet/smtpd_relay_restrictions=permit_mynetworks,reject" \
  "2525/inet/smtpd_recipient_restrictions=permit_mynetworks,reject"

# Pipe transport to the API for everything received on MAIL_DOMAIN.
postconf -M "pingsell-hook/unix=pingsell-hook unix - n n - 4 pipe flags=Rq user=nobody argv=/usr/local/bin/mta-hook \${recipient}"

postfix set-permissions >/dev/null 2>&1 || true
postfix check

# --- DNS records to publish (printed at every start) ------------------------------------
# (Plain pipeline into a file: parentheses inside $( ) trip up some shells.)
tr -d '\n\t' < "/data/dkim/${DKIM_SELECTOR}.txt" \
  | sed 's/^[^(]*(//; s/).*$//; s/"[[:space:]]*"//g; s/"//g; s/^[[:space:]]*//; s/[[:space:]]*$//' > /data/dkim/dns-record.txt
DKIM_TXT=$(cat /data/dkim/dns-record.txt)
cat <<EOF
[mta] ---------------------------------------------------------------------------
[mta] Enregistrements DNS à créer pour ${MAIL_DOMAIN} (remplacer <IP> par l'IP du serveur) :
[mta]   ${MAIL_HOSTNAME}.                       A     <IP>
[mta]   ${MAIL_DOMAIN}.                         MX    10 ${MAIL_HOSTNAME}.
[mta]   ${MAIL_DOMAIN}.                         TXT   "v=spf1 ip4:<IP> -all"
[mta]   ${MAIL_HOSTNAME}.                       TXT   "v=spf1 a -all"
[mta]   ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}.  TXT   "${DKIM_TXT}"
[mta]   _dmarc.${MAIL_DOMAIN}.                  TXT   "v=DMARC1; p=none; adkim=s; aspf=s; rua=mailto:dmarc@${MAIL_DOMAIN}"
[mta]   Reverse DNS (PTR) de <IP> :  ${MAIL_HOSTNAME}
[mta] ---------------------------------------------------------------------------
EOF

opendkim -x /etc/opendkim/opendkim.conf
exec postfix start-fg
