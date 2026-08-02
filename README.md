# Peddapalli Road Risk AI — Frontend

React + Vite + TypeScript + Tailwind + React-Leaflet + Framer Motion.
Still one flat file (`src/App.tsx`) — no `/components`, `/api`, `/types`
folders — per the standing project preference.

## Environment variable

**`VITE_API_BASE_URL`** — your deployed Render backend URL, no trailing
slash. Local dev: copy `.env.example` to `.env`. Vercel: Project Settings →
Environment Variables.

## Design decisions reconciled against the new brief

The redesign brief was written against a hypothetical `/api/*` backend
that doesn't match what's actually deployed. This build stays functionally
honest against your real backend:

- **Endpoints**: calls the real `/health`, `/places`, `/predict/risk`,
  `/predict/route`, `/hotspots`, `/analytics` — not the brief's `/api/*`
  paths, which don't exist on your backend.
- **Model badges**: show the real, live values from `/health`
  (`model_type`, `feature_count`, `road_segments_loaded`) — not the
  brief's placeholder "68 Segments / 14-Factor / 100% acc / RF+GB both
  running." Your model is a regressor (R²/MAE, not classification
  "accuracy"), only one model type is actually loaded at a time, and it
  genuinely has 61 segments / 10 features. Showing fake precision on a
  safety tool felt like the wrong call.
- **"Model Training… (~30–60s)" badge**: your backend trains
  synchronously before it accepts any requests, so there's no real
  "training in progress" state a client can observe. The status badge
  reflects real connection state instead (Connecting → Model ready / API
  offline).
- **"Auto (Live Weather)" + live temperature**: dropped. This needs a real
  third-party weather API key, which isn't something to fabricate. Weather
  selection still covers everything your model actually supports (Clear /
  Rain / Fog / Heavy Rain). Add a weather provider later and this is a
  small, contained addition.
- **`via`, `risk_cut_percent`, "balanced" route, per-segment `factors`**:
  none of these are separate backend fields — all derived client-side from
  your real route/segment data (see `categorizeRoutes`, `riskCutPercent`,
  `viaFromSegments` in `App.tsx`), plus a few supplementary
  `/predict/risk` calls per flagged segment to populate the Explain tab.
- **Location chips**: pulled live from `/places`, not hardcoded to the
  brief's example names (some, like "Sultanabad"/"NTPC", aren't nodes in
  your routing graph — hardcoding them would let someone pick a location
  that breaks route computation).
- **Dark theme**: this is a real reversal of the earlier "green and white,
  no cyberpunk" instruction — the new brief asks for it explicitly and in
  detail, so it's treated as superseding for visual direction. Kept clear
  of neon/glow/scanlines regardless; brand green carries through as the
  accent color and the "safe" signal.

## Local dev / build / deploy

Same as before — see the previous section below.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build -> dist/
npm run preview
```

Vercel: import repo → Framework preset **Vite** (auto-detected) → add
`VITE_API_BASE_URL` → deploy. Then add your Vercel URL to the backend's
`CORS_ORIGINS` on Render and redeploy the backend.
