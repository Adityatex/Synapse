# HOW TO RUN

## Prerequisites

Install these on your system before starting the project:

- Node.js 20 or newer
- npm 10 or newer
- MongoDB connection string
- RapidAPI Judge0 API credentials
- Git (optional, but recommended for collaboration)

## Required environment variables

`server/.env.example` and `client/.env.example` are the authoritative lists —
every variable is documented there with required/optional markers and safe
placeholders. Copy them to `.env` (gitignored, never commit real values):

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Minimum local backend (`server/.env`):

```env
JWT_SECRET=a_random_secret_at_least_32_chars_long
MONGODB_URI=your_mongodb_connection_string
JUDGE0_API_HOST=judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=your_rapidapi_key
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=you@yourdomain.com
```

For Render deployment, additionally set `NODE_ENV=production`,
`CORS_ORIGIN=https://your-vercel-app.vercel.app` (both required in
production — the server refuses to boot without them).

If port `5000` is already in use on a machine, change the backend port in `server/.env` and set matching client values in `client/.env`:

```env
VITE_BACKEND_PORT=5001
VITE_DEV_BACKEND_URL=http://localhost:5001
VITE_API_URL=http://localhost:5001/api
VITE_SOCKET_URL=http://localhost:5001
```

You can copy the template from `client/.env.example`.

For Vercel deployment, set these production client variables:

```env
VITE_API_URL=https://your-render-service.onrender.com/api
VITE_SOCKET_URL=https://your-render-service.onrender.com
VITE_PUBLIC_APP_URL=https://your-vercel-app.vercel.app
```

For cross-machine local collaboration, all users must connect to the same machine running the backend. Do not have each user run their own backend if they need to join the same room.

Recommended host machine setup:

```env
# server/.env
PORT=5000
MONGODB_URI=your_shared_mongodb_connection_string
JWT_SECRET=your_shared_jwt_secret
JUDGE0_API_HOST=judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=your_judge0_api_key
```

```env
# client/.env on the host machine
VITE_DEV_HOST=0.0.0.0
VITE_PORT=5173
VITE_DEV_BACKEND_URL=http://localhost:5000
VITE_API_URL=http://YOUR_LAN_IP:5000/api
VITE_SOCKET_URL=http://YOUR_LAN_IP:5000
VITE_PUBLIC_APP_URL=http://YOUR_LAN_IP:5173
```
Other users on the same network should open `http://YOUR_LAN_IP:5173` in their browser. That makes copied invite links point to the reachable host instead of `localhost`.

## Install dependencies

From the project root, run:

```bash
npm install
npm run install:all
```

## Start the app

Use either of these options from the project root:

```bash
npm run dev
```

Or on Windows:

```bat
start.bat
```

## Default local URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5000`
- Health check: `http://localhost:5000/api/health`

## Notes

- The backend can start even if MongoDB is unavailable, but authentication and room persistence will not work correctly.
- Code execution depends on valid Judge0 API credentials in `server/.env`.
- Shared rooms are stored in server memory right now, so everyone must use the same running backend process to collaborate in one room.
- OTP auth (signup + login) sends codes via **Brevo** by default
  (`BREVO_API_KEY` + verified `BREVO_SENDER_EMAIL`). Signup creates the
  account only after OTP verification, and login issues the JWT only after
  both password and OTP are verified. Gmail SMTP via App Password remains as
  a legacy fallback, but is rate-limited and often blocked on cloud hosts —
  use Brevo in production.
- Rooms can be created **invite-only** (checkbox on the create page, or
  `PATCH /api/rooms/:roomId` by the creator). Invite-only rooms admit only
  the creator and members who already joined; anyone else receives a
  room error. This is an interim guard, not a full role system.

## Deployment

- Render backend: `render.yaml` at the repo root declares the `synapse-api`
  service on the **Starter** plan (always-on — no free-tier sleeping, so no
  cold starts and WebSocket sessions survive idle periods). Deploy via
  Dashboard → New → Blueprint, or upgrade an existing Free service to
  Starter in Settings → Instance Type. Set every `sync: false` variable in
  the dashboard (secrets are never committed). Health checks run against
  `/api/health`.
- Vercel frontend: set the root directory to `client`; the root `vercel.json` enables React Router deep links.
- Keep the backend and frontend URLs in sync across Render and Vercel env vars so API calls and Socket.IO connect to the deployed backend.
- Uptime monitoring: see `docs/uptime-monitoring.md` for the free-tier
  UptimeRobot setup (`/api/health` keyword monitor + web root monitor with
  team alerts).
