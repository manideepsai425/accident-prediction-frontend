# Peddapalli SafeRoute — Frontend

React + Vite + TypeScript + Tailwind + React-Leaflet frontend for the
Peddapalli accident-risk & safest-route API. Deliberately flat: everything
lives in `src/App.tsx` — no `/components`, `/api`, or `/types` folders.

## Environment variable

**`VITE_API_BASE_URL`** — the only one this app needs. Your deployed Render
backend URL, no trailing slash, e.g. `https://accident-prediction-backend.onrender.com`.

- Local dev: copy `.env.example` to `.env` and set it (defaults to `http://localhost:8000`).
- Vercel: Project Settings → Environment Variables → add `VITE_API_BASE_URL` = your Render URL, for Production (and Preview if you want previews to work too).

## Local dev

```bash
npm install
npm run dev
# -> http://localhost:5173
```

Make sure the backend is running locally at the URL in `.env` (or deployed,
if you point `VITE_API_BASE_URL` at Render).

## Deploy to Vercel

1. Push this folder to a GitHub repo (or `vercel --prod` directly from here with the Vercel CLI).
2. Vercel dashboard → **Add New → Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output dir `dist` (defaults are already correct).
4. Add the `VITE_API_BASE_URL` environment variable (see above) before the first deploy, or redeploy after adding it.
5. Deploy.

## One important backend step

Once you know your Vercel URL, add it to the backend's `CORS_ORIGINS` env
var on Render (comma-separated if you keep others), then redeploy the
backend — otherwise the browser will block requests with a CORS error.

## Build

```bash
npm run build    # type-checks with tsc -b, then builds with Vite -> dist/
npm run preview  # serve the production build locally
```
