# HOW TO RUN

## Prerequisites

Install these on your system before starting the project:

- Node.js 20 or newer
- npm 10 or newer
- MongoDB connection string
- RapidAPI Judge0 API credentials
- Git (optional, but recommended for collaboration)

## Required environment variables

Create a file at `server/.env` and add the following values:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
JUDGE0_API_HOST=your_judge0_host
JUDGE0_API_KEY=your_rapidapi_key
GMAIL_USER=your_gmail_address@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
EMAIL_FROM=Synapse <your_gmail_address@gmail.com>
OTP_EXPIRY_MINUTES=10
OTP_MAX_ATTEMPTS=5
```

You can copy the template from `server/.env.example`.

If port `5000` is already in use on a machine, change the backend port in `server/.env` and set matching client values in `client/.env`:

```env
VITE_BACKEND_PORT=5001
VITE_DEV_BACKEND_URL=http://localhost:5001
VITE_API_URL=http://localhost:5001/api
VITE_SOCKET_URL=http://localhost:5001
```

You can copy the template from `client/.env.example`.

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
- Gmail OTP auth is enabled for both signup and login. Signup creates the account only after OTP verification, and login issues the JWT only after both password and OTP are verified.
- For Gmail, use an App Password rather than your normal inbox password. The backend sends OTPs with Nodemailer and stores temporary OTP records in MongoDB with automatic expiry.
