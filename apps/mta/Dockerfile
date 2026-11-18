# Pingsell MTA: our own outgoing mail server (Postfix + OpenDKIM). No third-party email service.
#  - port 2525 (internal only): the API hands messages over here
#  - port 25 (public): delivery to recipients' servers, and reception of bounces / complaints
#    for MAIL_DOMAIN, which are forwarded to the API (POST /webhooks/mta).
FROM alpine:3.22

RUN apk add --no-cache postfix opendkim opendkim-utils openssl curl ca-certificates tzdata

COPY entrypoint.sh /usr/local/bin/mta-entrypoint
COPY mta-hook.sh /usr/local/bin/mta-hook
RUN chmod 755 /usr/local/bin/mta-entrypoint /usr/local/bin/mta-hook

EXPOSE 25 2525
# /data: DKIM key + TLS certificate (keep it: the DKIM key is published in DNS).
# /var/spool/postfix: the mail queue (messages waiting for a retry survive a restart).
VOLUME ["/data", "/var/spool/postfix"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD postfix status >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/mta-entrypoint"]
