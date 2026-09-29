# Nextfi Software HTTPS (legacy VPS notes)

These notes document the retired VPS/Docker deployment and are kept only for
historical migration reference. Current production runs on Vercel.

Nginx terminates HTTP at the Nginx edge. The production Compose file
publishes only Nginx on ports 80 and 443; web, API, PostgreSQL, and Redis remain
on the internal Docker network. The Nginx template redirects HTTP to HTTPS,
sets TLS/security headers, limits API requests, supports proxy upgrades, and
enforces request-size limits for workspace attachments.

## Initial certificate

Point DNS for `VROMPT_DOMAIN` at the VPS before requesting a certificate. On
the host, stop only the Nginx container so Certbot can bind port 80:

```bash
sudo certbot certonly --standalone -d vrompt.example.com
docker compose --env-file .env.production -f docker-compose.prod.yml up -d vrompt-nginx
```

Set `VROMPT_LETSENCRYPT_DIR`, `VROMPT_TLS_CERT_PATH`, and
`VROMPT_TLS_KEY_PATH` in `.env.production` to match the mounted certificate
paths. These values are paths only; no provider credential is passed to
Nginx or the browser.

## Renewal

Certbot installs a systemd timer on Ubuntu. Verify it and perform a dry run:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Use a deploy hook to reload Nginx after a successful renewal:

```bash
sudo certbot renew --deploy-hook \
  'cd /srv/vrompt && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T vrompt-nginx nginx -s reload'
```

Keep the renewal command in the host's root-owned systemd/Certbot configuration
and verify the next renewal in the VPS logs. Phase 38 does not claim HTTPS is
live until DNS, a real certificate, and the renewal dry run have succeeded.
