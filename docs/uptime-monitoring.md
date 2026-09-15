# Uptime monitoring (P0-15)

Free-tier setup with [UptimeRobot](https://uptimerobot.com) (free plan:
50 monitors, 5-minute checks, email alerts). Any equivalent free monitor
(Better Uptime, Hyperping) works — the contracts below are what matters.

## Monitors to create (2)

### 1. API health — `synapse-api`
- **Type:** HTTP(s) → Keyword
- **URL:** `https://<your-render-service>.onrender.com/api/health`
- **Keyword:** `ok` (the endpoint returns `{"status":"ok",...}` with HTTP 200 —
  alert when the keyword is ABSENT)
- **Interval:** 5 minutes (free tier)
- **Alert when:** keyword missing OR status != 2xx for 2 consecutive checks

Why keyword and not just status: Render's edge can return its own pages
during deploys; matching `"ok"` proves our Node process actually answered.

### 2. Web root — `synapse-web`
- **Type:** HTTP(s)
- **URL:** `https://<your-vercel-app>.vercel.app/`
- **Alert when:** status != 2xx for 2 consecutive checks
- **Interval:** 5 minutes (free tier)

## Team alerts
1. UptimeRobot → My Settings → Alert Contacts → add each teammate's email
   (and Slack webhook if the team uses Slack).
2. Attach those contacts to BOTH monitors above.
3. Send a test alert (Monitor → … → Test alert contact) and confirm receipt.

## Outage-detection acceptance
- Kill-switch test: put the Render service in maintenance (or stop it) and
  confirm an alert email arrives within ~10 minutes (2 missed 5-minute checks
  + delivery). Record the date/result below.
- Recovery test: restart and confirm the "monitor is up" notification.

## Log

| Date | Test | Result |
|------|------|--------|
| _pending_ | API down → alert received ≤ 10 min | _run after deploy_ |
| _pending_ | Web down → alert received ≤ 10 min | _run after deploy_ |
| _pending_ | Recovery notifications received | _run after deploy_ |

> Note: creating the UptimeRobot account and running the kill-switch tests
> are operational steps done in the dashboard after deploy — they cannot be
> committed. The monitor contracts (endpoint shape, keyword) are covered by
> `server/tests/p0-group4.test.js` so CI guards them.
