# Deploying Synapse

One production image (root `Dockerfile`) serves the API, Socket.IO and the
built client on a single origin. It runs two ways:

| | Public demo from a laptop | Fly.io |
|---|---|---|
| Needs | Docker Desktop, internet | Fly account **with a card** (trial machines stop after 5 min) |
| URL | `https://<random>.trycloudflare.com`, new on every restart | `https://<app>.fly.dev`, stable |
| Config | `docker-compose.demo.yml` | `fly.toml` |
| Secrets | `server/.env` | `bash scripts/fly-secrets.sh <app>` (from `server/.env`) |

**Single instance only.** Rooms, presence and locks live in server memory until
Phase 2 (Hocuspocus + Redis). Run exactly one container/machine, and remember
that every restart or deploy drops open rooms. Don't deploy during a demo.

## A. Public demo via Cloudflare Tunnel

```bash
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml logs tunnel | grep trycloudflare.com
```

Open the printed `https://….trycloudflare.com` URL. That's the link to share.

- Stop: `docker compose -f docker-compose.demo.yml down`.
- Restart only the tunnel (new URL): `docker compose -f docker-compose.demo.yml restart tunnel`.
- Logs: `docker compose -f docker-compose.demo.yml logs -f app`.
- The tunnel uses HTTP/2 (`--protocol http2`) because QUIC/UDP is often blocked
  on campus networks.
- Quick tunnels are Cloudflare's no-account testing mode, with no uptime
  guarantee. The laptop must stay awake and online (disable sleep).
- MongoDB Atlas must allow this machine's public IP (Atlas → Network Access).

## B. Fly.io

One-time setup:

```bash
fly auth login
fly apps create <app>                 # app names are global; then set `app` and
                                      # CORS_ORIGIN = https://<app>.fly.dev in fly.toml
bash scripts/fly-secrets.sh <app>     # stages secrets from server/.env, prints names only
fly deploy --ha=false                 # --ha=false = exactly one machine (see above)
fly status                            # expect 1 machine, state "started"
```

- Atlas → Network Access must allow `0.0.0.0/0`. Fly egress IPs aren't fixed.
- If Gmail SMTP is blocked from Fly, add `BREVO_API_KEY` + `BREVO_SENDER_EMAIL`
  to `server/.env`, rerun the secrets script and `fly deploy`. In an emergency
  the OTP is logged when every provider fails: `fly logs | grep -i otp`.
- Later: `fly.staging.toml` + `.github/workflows/staging.yml` (manual-only
  today) deploy the same image to a staging app once `FLY_API_TOKEN` exists.

## Smoke test (after every start/deploy)

1. `GET /api/health` → `{"status":"ok","db":"connected"}`.
2. Sign up with a real inbox → OTP email arrives → logged in.
3. Create a room, click **Invite** (copies a signed link, valid 7 days), open it in
   an incognito window and log in as a **second account**. You land in the room.
4. Type in one window, see it in the other. Cursors and presence show.
5. Run code (default file is Python: `print("hello")`). Output appears.
6. Ask Neura (AI panel) a question. A reply appears.

## Demo day

- Start the stack **≥30 min early**, run the smoke test, then don't touch it.
- Fallbacks, in order:
  1. Tunnel URL dies → `restart tunnel`, share the new URL.
  2. Venue blocks tunnels → present from the laptop at `http://localhost:8080`.
  3. Atlas unreachable (network/IP allowlist) → `docker compose up -d` (local
     Mongo + Mailpit; OTPs at http://localhost:8025) and use the dev client.
  4. Gmail fails → OTP fallback is logged: `… logs app | grep -i otp`.
