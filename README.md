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
