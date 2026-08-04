/**
 * App.tsx — Peddapalli Road Risk AI
 *
 * Kept to one flat file on purpose (no /components, /api, /types folders),
 * per the standing preference from earlier in this project. A few tiny
 * local helper functions exist purely to avoid repeating markup, not as an
 * architectural split.
 *
 * Wired to the REAL backend endpoints (/health, /places, /predict/risk,
 * /predict/route, /hotspots, /analytics) rather than the illustrative
 * /api/* paths from the redesign brief, since this has to work against the
 * actual deployed API, not a hypothetical one. A few numbers in the brief
 * (68 segments, 14-factor model, "100% acc", both RF+GB running at once,
 * live weather) were placeholders from wherever that brief came from --
 * this build shows the real, live numbers instead (see the chat reply for
 * the full list of what was reconciled and why).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts'

/* ============================================================================
 * Config
 * ==========================================================================*/

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8000'
const PEDDAPALLI_CENTER: [number, number] = [18.616, 79.383]
const RISK_COLORS = { Low: '#16A34A', Medium: '#F59E0B', High: '#DC2626' } as const
const PIE_COLORS = ['#16A34A', '#F59E0B', '#DC2626']
const TIME_OPTIONS: TimeOfDay[] = ['Morning', 'Afternoon', 'Evening', 'Night']
const WEATHER_OPTIONS: Weather[] = ['Clear', 'Rain', 'Fog', 'Heavy Rain']
const WEATHER_EMOJI: Record<Weather, string> = { Clear: '☀️', Rain: '🌧️', Fog: '🌫️', 'Heavy Rain': '⛈️' }
const TIME_EMOJI: Record<TimeOfDay, string> = { Morning: '🌅', Afternoon: '🌤️', Evening: '🌇', Night: '🌙' }
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid #EDE7D8',
  boxShadow: '0 8px 24px rgba(18,39,30,0.12)',
  fontSize: 12,
  fontFamily: 'inherit',
}

function riskColor(score: number): string {
  if (score > 0.7) return RISK_COLORS.High
  if (score > 0.4) return RISK_COLORS.Medium
  return RISK_COLORS.Low
}
function riskLevelFor(score: number): RiskLevel {
  if (score > 0.7) return 'High'
  if (score > 0.4) return 'Medium'
  return 'Low'
}
function formatModelName(raw: string | null): string {
  if (!raw) return 'Model'
  return raw
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/* ============================================================================
 * Types (mirror the FastAPI backend's real Pydantic schemas)
 * ==========================================================================*/

type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Night'
type Weather = 'Clear' | 'Rain' | 'Fog' | 'Heavy Rain'
type RiskLevel = 'Low' | 'Medium' | 'High'
type ResultTab = 'routes' | 'details' | 'risk' | 'explain'
type Page = 'planner' | 'analytics'

interface Place {
  name: string
  latitude: number
  longitude: number
}

interface HealthResponse {
  status: string
  model_loaded: boolean
  model_type: string | null
  feature_count: number
  accidents_loaded: number
  road_segments_loaded: number
  graph_nodes: number
  version: string
}

interface RiskResponse {
  risk_score: number
  risk_level: RiskLevel
  nearest_road_name: string | null
  contributing_factors: string[]
  explanation: string
}

interface RouteSegment {
  segment_id: string
  road_name: string
  start: [number, number]
  end: [number, number]
  length_km: number
  risk_score: number
  risk_level: RiskLevel
  warning: string | null
}

interface RouteOption {
  route_id: string
  label: string
  coordinates: [number, number][]
  overall_risk_score: number
  total_distance_km: number
  est_travel_time_min: number
  segments: RouteSegment[]
  high_risk_segment_count: number
  summary: string
}

interface RouteResponse {
  origin: [number, number]
  destination: [number, number]
  safest_route: RouteOption
  alternatives: RouteOption[]
  warnings: string[]
  explanation: string
}

interface Hotspot {
  road_segment_id: string
  road_name: string
  latitude: number
  longitude: number
  accident_count: number
  avg_risk_score: number
  risk_level: RiskLevel
  dominant_severity: string
  dominant_weather: string
  dominant_time_of_day: string
}

interface CategoryBreakdown {
  category: string
  count: number
  percentage: number
}

interface MonthlyTrendPoint {
  year_month: string
  accident_count: number
}

interface AnalyticsResponse {
  total_accidents: number
  avg_risk_score: number
  severity_breakdown: CategoryBreakdown[]
  weather_breakdown: CategoryBreakdown[]
  time_of_day_breakdown: CategoryBreakdown[]
  road_type_breakdown: CategoryBreakdown[]
  top_risky_roads: CategoryBreakdown[]
  monthly_trend: MonthlyTrendPoint[]
  peak_hour_share: number
  intersection_share: number
  curve_share: number
}

/* ============================================================================
 * API helpers
 * ==========================================================================*/

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const getPlaces = () => apiGet<{ places: Place[] }>('/places').then((d) => d.places)
const getHealth = () => apiGet<HealthResponse>('/health')
const getHotspots = (topN: number) => apiGet<{ hotspots: Hotspot[] }>(`/hotspots?top_n=${topN}`)
const getAnalytics = () => apiGet<AnalyticsResponse>('/analytics')

const postPredictRisk = (payload: {
  latitude: number
  longitude: number
  time_of_day: TimeOfDay
  weather_condition: Weather
}) => apiPost<RiskResponse>('/predict/risk', payload)

const postPredictRoute = (payload: {
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  preferred_time: TimeOfDay
  weather_condition: Weather
}) => apiPost<RouteResponse>('/predict/route', payload)

/* ============================================================================
 * Route categorisation & derived stats
 * (the backend returns safest + ranked alternatives; "fastest"/"balanced"
 * are labels this file derives from that real data, not separate API calls)
 * ==========================================================================*/

function categorizeRoutes(result: RouteResponse) {
  const safest = result.safest_route
  const alts = result.alternatives
  if (alts.length === 0) return { safest, fastest: null as RouteOption | null, balanced: null as RouteOption | null }
  const fastest = alts.reduce((a, b) => (a.total_distance_km <= b.total_distance_km ? a : b))
  const balanced = alts.find((r) => r.route_id !== fastest.route_id) ?? null
  return { safest, fastest, balanced }
}

function riskCutPercent(safest: RouteOption, alternatives: RouteOption[]): number {
  if (alternatives.length === 0) return 0
  const worst = Math.max(...alternatives.map((r) => r.overall_risk_score))
  if (worst <= 0) return 0
  return Math.max(0, Math.round((1 - safest.overall_risk_score / worst) * 100))
}

function viaFromSegments(segments: RouteSegment[]): string[] {
  const via: string[] = []
  for (const seg of segments) {
    if (via[via.length - 1] !== seg.road_name) via.push(seg.road_name)
  }
  return via
}

/* ============================================================================
 * Tiny presentational helpers -- see file header note
 * ==========================================================================*/

function RiskPill({ level }: { level: RiskLevel }) {
  const styles: Record<RiskLevel, string> = {
    Low: 'bg-brand-mist text-brand-deep',
    Medium: 'bg-amber-100 text-amber-700',
    High: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${styles[level]}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: RISK_COLORS[level] }} />
      {level}
    </span>
  )
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{children}</div>
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-stone-100 backdrop-blur-sm">
      {children}
    </span>
  )
}

function ScoreBar({ score, level }: { score: number; level: RiskLevel }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: RISK_COLORS[level] }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(score * 100)}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  )
}

/** react-leaflet exposes map clicks only via a hook that must run inside a
 * child of <MapContainer> -- an unavoidable 4-line wrapper, not a split. */
function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/** Same story: Leaflet needs `invalidateSize()` after its container is
 * resized (e.g. entering/leaving fullscreen), and that's only reachable
 * via the useMap() hook from inside the map. */
function FullscreenSync({ isFullscreen }: { isFullscreen: boolean }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 260)
    return () => clearTimeout(t)
  }, [isFullscreen, map])
  return null
}

/* ============================================================================
 * App
 * ==========================================================================*/

export default function App() {
  const [page, setPage] = useState<Page>('planner')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthChecked, setHealthChecked] = useState(false)
  const [places, setPlaces] = useState<Place[]>([])

  // Journey planner
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')
  const [preferredTime, setPreferredTime] = useState<TimeOfDay>('Afternoon')
  const [weather, setWeather] = useState<Weather>('Clear')
  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ResultTab>('routes')

  // Map controls
  const [mapVisible, setMapVisible] = useState(true)
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const [showHotspots, setShowHotspots] = useState(false)
  const [hotspots, setHotspots] = useState<Hotspot[]>([])
  const [hotspotsLoading, setHotspotsLoading] = useState(false)

  // Point risk checker (kept from the previous build -- the brief doesn't
  // ask to remove it, and it's a real, cheap capability the API supports)
  const [checkPoint, setCheckPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [checkResult, setCheckResult] = useState<RiskResponse | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)

  // Per-segment explanation cache for the "Explain" tab -- fetched lazily
  // by calling /predict/risk at each flagged segment's midpoint, since the
  // route endpoint itself only returns a single `warning` string per
  // segment, not a full factor list.
  const [segmentFactors, setSegmentFactors] = useState<Record<string, string[]>>({})
  const [factorsLoading, setFactorsLoading] = useState(false)

  // Analytics (fetched on demand)
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]))
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setHealthChecked(true))
  }, [])

  useEffect(() => {
    if (page === 'analytics' && !analytics && !analyticsLoading) {
      setAnalyticsLoading(true)
      setAnalyticsError(null)
      getAnalytics()
        .then(setAnalytics)
        .catch((e: unknown) => setAnalyticsError(e instanceof Error ? e.message : 'Could not load analytics.'))
        .finally(() => setAnalyticsLoading(false))
    }
  }, [page, analytics, analyticsLoading])

  const allRoutes = useMemo<RouteOption[]>(
    () => (routeResult ? [routeResult.safest_route, ...routeResult.alternatives] : []),
    [routeResult],
  )
  const selectedRoute = useMemo(
    () => allRoutes.find((r) => r.route_id === selectedRouteId) ?? null,
    [allRoutes, selectedRouteId],
  )
  const categorized = useMemo(() => (routeResult ? categorizeRoutes(routeResult) : null), [routeResult])
  const cutPercent = useMemo(
    () => (routeResult ? riskCutPercent(routeResult.safest_route, routeResult.alternatives) : 0),
    [routeResult],
  )
  const riskiestSegments = useMemo(() => {
    if (!selectedRoute) return []
    return [...selectedRoute.segments].sort((a, b) => b.risk_score - a.risk_score).slice(0, 10)
  }, [selectedRoute])

  // Fetch per-segment factors for the selected route's flagged segments
  // whenever the selection changes (cached by segment_id, so re-selecting
  // a route already viewed doesn't refetch).
  useEffect(() => {
    if (!selectedRoute) return
    const flagged = selectedRoute.segments.filter((s) => s.risk_level !== 'Low' && !segmentFactors[s.segment_id])
    if (flagged.length === 0) return
    setFactorsLoading(true)
    Promise.all(
      flagged.map(async (s): Promise<[string, string[]]> => {
        const mid: [number, number] = [(s.start[0] + s.end[0]) / 2, (s.start[1] + s.end[1]) / 2]
        try {
          const r = await postPredictRisk({
            latitude: mid[0],
            longitude: mid[1],
            time_of_day: preferredTime,
            weather_condition: weather,
          })
          const factors: string[] = r.contributing_factors.length > 0 ? r.contributing_factors : [r.explanation]
          return [s.segment_id, factors]
        } catch {
          const factors: string[] = [s.warning ?? `${s.risk_level} risk segment`]
          return [s.segment_id, factors]
        }
      }),
    ).then((entries) => {
      setSegmentFactors((prev) => {
        const next = { ...prev }
        for (const [id, factors] of entries) next[id] = factors
        return next
      })
      setFactorsLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute])

  const handleFindRoute = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const origin = places.find((p) => p.name.toLowerCase() === originName.trim().toLowerCase())
      const dest = places.find((p) => p.name.toLowerCase() === destName.trim().toLowerCase())
      if (!origin || !dest) {
        setRouteError('Pick an origin and destination from the list or the chips below.')
        return
      }
      if (origin.name === dest.name) {
        setRouteError('Origin and destination must be different places.')
        return
      }
      setRouteLoading(true)
      setRouteError(null)
      setSegmentFactors({})
      try {
        const result = await postPredictRoute({
          origin_lat: origin.latitude,
          origin_lng: origin.longitude,
          dest_lat: dest.latitude,
          dest_lng: dest.longitude,
          preferred_time: preferredTime,
          weather_condition: weather,
        })
        setRouteResult(result)
        setSelectedRouteId(result.safest_route.route_id)
        setActiveTab('routes')
        // Auto-scroll to the results section once it has rendered.
        requestAnimationFrame(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      } catch (err) {
        setRouteResult(null)
        setRouteError(err instanceof Error ? err.message : 'Could not compute a route.')
      } finally {
        setRouteLoading(false)
      }
    },
    [places, originName, destName, preferredTime, weather],
  )

  const handleSwap = useCallback(() => {
    setOriginName(destName)
    setDestName(originName)
  }, [originName, destName])

  const handleChipClick = useCallback(
    (name: string) => {
      if (originName === name) {
        setOriginName('')
      } else if (destName === name) {
        setDestName('')
      } else if (!originName) {
        setOriginName(name)
      } else if (!destName) {
        setDestName(name)
      } else {
        setOriginName(name)
      }
    },
    [originName, destName],
  )

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setCheckPoint({ lat, lng })
    setCheckResult(null)
  }, [])

  const handleCheckRisk = useCallback(async () => {
    if (!checkPoint) return
    setCheckLoading(true)
    try {
      const result = await postPredictRisk({
        latitude: checkPoint.lat,
        longitude: checkPoint.lng,
        time_of_day: preferredTime,
        weather_condition: weather,
      })
      setCheckResult(result)
    } catch {
      // inline check is supplementary -- fail quietly
    } finally {
      setCheckLoading(false)
    }
  }, [checkPoint, preferredTime, weather])

  const toggleHotspots = useCallback(async () => {
    const next = !showHotspots
    setShowHotspots(next)
    if (next && hotspots.length === 0) {
      setHotspotsLoading(true)
      try {
        const data = await getHotspots(15)
        setHotspots(data.hotspots)
      } catch {
        // supplementary layer -- fail quietly
      } finally {
        setHotspotsLoading(false)
      }
    }
  }, [showHotspots, hotspots.length])

  const statusLabel = !healthChecked ? '📡 Connecting…' : health?.status === 'ok' ? '✅ Model ready' : '⚠️ API offline'
  const statusOk = healthChecked && health?.status === 'ok'

  return (
    <div className="min-h-screen bg-canvas">
      {/* ======================= Dark gradient header ======================= */}
      <header className="relative bg-gradient-to-br from-navy to-navy-light pb-8 pt-6 sm:pb-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-base font-bold text-white shadow-lg shadow-brand/30">
                🚦
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight tracking-tight text-white sm:text-xl">Peddapalli Road Risk AI</h1>
                <p className="text-xs leading-tight text-stone-400">ML Risk Scoring · Dijkstra Routing · Telangana</p>
              </div>
            </div>
            <nav className="flex rounded-full bg-white/10 p-1 text-sm font-medium backdrop-blur-sm">
              <button
                onClick={() => setPage('planner')}
                className={`rounded-full px-3.5 py-1.5 transition-all duration-150 ease-spring active:scale-[0.94] ${page === 'planner' ? 'bg-white text-navy' : 'text-stone-300 hover:text-white'}`}
              >
                Planner
              </button>
              <button
                onClick={() => setPage('analytics')}
                className={`rounded-full px-3.5 py-1.5 transition-all duration-150 ease-spring active:scale-[0.94] ${page === 'analytics' ? 'bg-white text-navy' : 'text-stone-300 hover:text-white'}`}
              >
                Analytics
              </button>
            </nav>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge>🧠 {formatModelName(health?.model_type ?? null)}</Badge>
            <Badge>📊 {health?.feature_count ?? 10}-Factor Model</Badge>
            <Badge>🛣️ {health?.road_segments_loaded ?? '—'} Segments</Badge>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                statusOk ? 'bg-brand-mist text-brand-deep' : 'bg-white/10 text-stone-300'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusOk ? 'animate-pulse bg-brand' : 'bg-stone-400'}`} />
              {statusLabel}
            </span>
          </div>
        </div>
      </header>

      {/* ======================= Journey planner (floats over header) ======================= */}
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        {page === 'planner' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="rounded-2xl bg-white p-4 shadow-raised sm:p-5"
          >
            <SectionLabel>🗺️ Plan your journey</SectionLabel>
            <form onSubmit={handleFindRoute} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 flex-col gap-2">
                  <input
                    list="place-list"
                    value={originName}
                    onChange={(e) => setOriginName(e.target.value)}
                    placeholder="📍 Origin — search or pick a chip below"
                    className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  />
                  <input
                    list="place-list"
                    value={destName}
                    onChange={(e) => setDestName(e.target.value)}
                    placeholder="🏁 Destination"
                    className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  />
                  <datalist id="place-list">
                    {places.map((p) => (
                      <option key={p.name} value={p.name} />
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={handleSwap}
                  aria-label="Swap origin and destination"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-all duration-150 ease-spring hover:border-brand hover:bg-brand-mist hover:text-brand-deep active:scale-90 active:rotate-180"
                >
                  ⇅
                </button>
              </div>

              {/* Quick-select location chips */}
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                style={{
                  maskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)',
                  WebkitMaskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)',
                }}
              >
                {places.map((p) => {
                  const role = originName === p.name ? 'A' : destName === p.name ? 'B' : null
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => handleChipClick(p.name)}
                      className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-spring active:scale-90 ${
                        role
                          ? 'scale-105 border-brand bg-brand-mist text-brand-deep shadow-sm'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-brand-mist'
                      }`}
                    >
                      {p.name}
                      {role && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">·{role}</span>}
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <select
                  value={weather}
                  onChange={(e) => setWeather(e.target.value as Weather)}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                >
                  {WEATHER_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {WEATHER_EMOJI[w]} {w}
                    </option>
                  ))}
                </select>
                <select
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value as TimeOfDay)}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {TIME_EMOJI[t]} {t}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={routeLoading}
                className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white shadow-raised transition-all duration-150 ease-spring hover:bg-brand-deep active:scale-[0.98] active:shadow-pressed disabled:opacity-60 disabled:active:scale-100"
              >
                {routeLoading ? (
                  <>
                    <Spinner /> ⌛ Computing routes…
                  </>
                ) : (
                  '🛣️ Find safest route'
                )}
              </button>
              <AnimatePresence>
                {routeError && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                  >
                    ⚠️ {routeError}
                  </motion.p>
                )}
              </AnimatePresence>
            </form>
          </motion.div>
        )}
      </div>

      {/* ======================= Page body ======================= */}
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
        {page === 'planner' ? (
          <div ref={resultsRef} className="scroll-mt-4">
            <AnimatePresence mode="wait">
              {routeResult && categorized && (
                <motion.div
                  key={routeResult.safest_route.route_id + preferredTime + weather}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="flex flex-col gap-5"
                >
                  {/* Summary header */}
                  <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">
                        🏢 {originName} → 🏢 {destName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-600">{weather}</span>
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-600">{preferredTime}</span>
                        <span className="rounded-full bg-brand-mist px-2.5 py-1 font-medium text-brand-deep">
                          {formatModelName(health?.model_type ?? null)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Map + Tabs grid */}
                  <div className={`grid grid-cols-1 gap-5 ${mapVisible ? 'lg:grid-cols-5' : ''}`}>
                    {mapVisible && (
                      <div className={mapFullscreen ? '' : 'relative h-[420px] lg:col-span-2 lg:h-auto'}>
                        <div
                          className={
                            mapFullscreen
                              ? 'fixed inset-0 z-[2000] h-screen w-screen'
                              : 'relative h-full w-full overflow-hidden rounded-2xl shadow-card'
                          }
                        >
                          <MapContainer center={PEDDAPALLI_CENTER} zoom={12} className="h-full w-full">
                            <TileLayer
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            />
                            <ClickCapture onClick={handleMapClick} />
                            <FullscreenSync isFullscreen={mapFullscreen} />

                            {allRoutes.map((route) => {
                              const isSelected = route.route_id === selectedRouteId
                              return (
                                <Polyline
                                  key={route.route_id}
                                  positions={route.coordinates}
                                  pathOptions={{
                                    color: isSelected ? riskColor(route.overall_risk_score) : '#9CA3AF',
                                    weight: isSelected ? 5 : 3,
                                    opacity: isSelected ? 0.95 : 0.45,
                                  }}
                                  eventHandlers={{ click: () => setSelectedRouteId(route.route_id) }}
                                />
                              )
                            })}

                            {selectedRoute?.segments
                              .filter((s) => s.risk_level !== 'Low')
                              .map((s) => (
                                <CircleMarker
                                  key={s.segment_id}
                                  center={[(s.start[0] + s.end[0]) / 2, (s.start[1] + s.end[1]) / 2]}
                                  radius={7}
                                  pathOptions={{ color: '#fff', weight: 2, fillColor: RISK_COLORS[s.risk_level], fillOpacity: 0.95 }}
                                >
                                  <Popup>
                                    <div className="text-sm">
                                      <p className="font-semibold">{s.road_name}</p>
                                      <p className="text-stone-500">{s.warning ?? `${s.risk_level} risk segment`}</p>
                                    </div>
                                  </Popup>
                                </CircleMarker>
                              ))}

                            <CircleMarker center={routeResult.origin} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: '#16A34A', fillOpacity: 1 }}>
                              <Tooltip permanent direction="top" offset={[0, -8]}>
                                Origin
                              </Tooltip>
                            </CircleMarker>
                            <CircleMarker
                              center={routeResult.destination}
                              radius={9}
                              pathOptions={{ color: '#fff', weight: 2, fillColor: '#12271E', fillOpacity: 1 }}
                            >
                              <Tooltip permanent direction="top" offset={[0, -8]}>
                                Destination
                              </Tooltip>
                            </CircleMarker>

                            {showHotspots &&
                              hotspots.map((h) => (
                                <CircleMarker
                                  key={h.road_segment_id}
                                  center={[h.latitude, h.longitude]}
                                  radius={6 + h.avg_risk_score * 10}
                                  pathOptions={{ color: RISK_COLORS[h.risk_level], weight: 1.5, fillColor: RISK_COLORS[h.risk_level], fillOpacity: 0.35 }}
                                >
                                  <Popup>
                                    <div className="text-sm">
                                      <p className="font-semibold">{h.road_name}</p>
                                      <p className="text-stone-500">
                                        {h.accident_count} accidents · avg risk {h.avg_risk_score.toFixed(2)}
                                      </p>
                                    </div>
                                  </Popup>
                                </CircleMarker>
                              ))}

                            {checkPoint && (
                              <CircleMarker
                                center={[checkPoint.lat, checkPoint.lng]}
                                radius={9}
                                pathOptions={{
                                  color: '#fff',
                                  weight: 2,
                                  fillColor: checkResult ? RISK_COLORS[checkResult.risk_level] : '#64748B',
                                  fillOpacity: 1,
                                }}
                              />
                            )}
                          </MapContainer>

                          {/* Map viewport controls */}
                          <div className="absolute right-3 top-3 z-[2100] flex gap-2">
                            <button
                              onClick={toggleHotspots}
                              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-glass backdrop-blur-md transition-all duration-150 ease-spring active:scale-90 ${
                                showHotspots ? 'bg-brand text-white' : 'bg-white/80 text-ink hover:bg-brand-mist'
                              }`}
                            >
                              {hotspotsLoading ? <Spinner className="h-3.5 w-3.5" /> : null} 🔥 Hotspots
                            </button>
                            {!mapFullscreen ? (
                              <button
                                onClick={() => setMapFullscreen(true)}
                                className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-ink shadow-glass backdrop-blur-md transition-all duration-150 ease-spring hover:bg-brand-mist active:scale-90"
                              >
                                ⛶ Full screen
                              </button>
                            ) : (
                              <button
                                onClick={() => setMapFullscreen(false)}
                                className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-ink shadow-glass backdrop-blur-md transition-all duration-150 ease-spring hover:bg-brand-mist active:scale-90"
                              >
                                ✕ Close
                              </button>
                            )}
                          </div>

                          {checkPoint && !mapFullscreen && (
                            <div className="absolute bottom-3 left-3 right-3 z-[2100] rounded-xl bg-white/90 p-3 shadow-glass backdrop-blur-md">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-stone-500">
                                  📍 Point check · {checkPoint.lat.toFixed(3)}, {checkPoint.lng.toFixed(3)}
                                </p>
                                <button
                                  onClick={handleCheckRisk}
                                  disabled={checkLoading}
                                  className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white transition-all duration-150 ease-spring active:scale-90 disabled:opacity-60"
                                >
                                  {checkLoading && <Spinner className="h-3 w-3" />} Check risk
                                </button>
                              </div>
                              {checkResult && (
                                <div className="mt-2 flex items-center gap-2">
                                  <RiskPill level={checkResult.risk_level} />
                                  <p className="text-xs text-stone-500">{checkResult.explanation}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Results tabs */}
                    <div className={mapVisible ? 'lg:col-span-3' : ''}>
                      <div className="flex items-center justify-between">
                        <div className="relative flex gap-1 rounded-full bg-stone-100 p-1 text-sm font-medium">
                          {(
                            [
                              ['routes', '✅ Routes'],
                              ['details', '🗺️ Details'],
                              ['risk', '📊 Risk'],
                              ['explain', '⚠️ Explain'],
                            ] as [ResultTab, string][]
                          ).map(([key, label]) => (
                            <button
                              key={key}
                              onClick={() => setActiveTab(key)}
                              className="relative rounded-full px-3 py-1.5 text-stone-500 transition-all duration-150 ease-spring active:scale-90 data-[active=true]:text-brand-deep"
                              data-active={activeTab === key}
                            >
                              {activeTab === key && (
                                <motion.span
                                  layoutId="tab-underline"
                                  className="absolute inset-0 rounded-full bg-white shadow-card"
                                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                                />
                              )}
                              <span className="relative">{label}</span>
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setMapVisible((v) => !v)}
                          className="hidden rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-all duration-150 ease-spring hover:border-brand hover:text-brand-deep active:scale-90 lg:inline-block"
                        >
                          {mapVisible ? 'Hide map' : 'Show map'}
                        </button>
                      </div>

                      <AnimatePresence mode="wait">
                        <motion.div
                          key={activeTab}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="mt-4 flex flex-col gap-4"
                        >
                          {/* -------- Routes tab -------- */}
                          {activeTab === 'routes' && (
                            <>
                              <div className="rounded-2xl border border-brand bg-brand-mist/40 p-4">
                                <div className="flex items-center justify-between">
                                  <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                                    🏆 Take this route
                                  </span>
                                  <span className="text-xs font-semibold text-brand-deep">
                                    {cutPercent > 0 ? `${cutPercent}% lower risk than the riskiest alternative` : 'Only viable route found'}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm font-semibold text-ink">{viaFromSegments(categorized.safest.segments).join(' → ')}</p>
                                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                  {[
                                    ['Distance', `${categorized.safest.total_distance_km} km`],
                                    ['Est. time', `${Math.round(categorized.safest.est_travel_time_min)} min`],
                                    ['Risk score', categorized.safest.overall_risk_score.toFixed(3)],
                                    ['Risk level', riskLevelFor(categorized.safest.overall_risk_score)],
                                  ].map(([label, value]) => (
                                    <div key={label} className="rounded-xl bg-white p-2.5">
                                      <p className="text-sm font-bold tabular-nums text-ink">{value}</p>
                                      <p className="text-[10px] uppercase tracking-wide text-stone-400">{label}</p>
                                    </div>
                                  ))}
                                </div>
                                <p className="mt-3 rounded-xl bg-white/70 p-2.5 text-xs leading-relaxed text-brand-deep">💡 {routeResult.explanation}</p>
                              </div>

                              {[categorized.safest, ...routeResult.alternatives]
                                .filter((r) => r.route_id !== categorized.safest.route_id && riskLevelFor(r.overall_risk_score) === 'High')
                                .map((r) => (
                                  <div key={r.route_id} className="rounded-2xl border border-red-200 bg-red-50 p-4">
                                    <div className="flex items-center justify-between">
                                      <span className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                                        🚫 Avoid — highest risk
                                      </span>
                                      <span className="text-xs font-bold text-red-700">Risk {r.overall_risk_score.toFixed(2)}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-red-900">{r.summary}</p>
                                    {r.high_risk_segment_count > 0 && (
                                      <p className="mt-1 text-xs text-red-700">{r.high_risk_segment_count} high-risk segment(s) on this path.</p>
                                    )}
                                  </div>
                                ))}

                              <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white shadow-card">
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="border-b border-stone-100 text-xs uppercase tracking-wide text-stone-400">
                                      <th className="px-4 py-3 font-medium">🛣️ Route</th>
                                      <th className="px-4 py-3 font-medium">📏 Distance (km)</th>
                                      <th className="px-4 py-3 font-medium">⏱️ Time (min)</th>
                                      <th className="px-4 py-3 font-medium">⚠️ Risk</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {allRoutes.map((r) => (
                                      <tr
                                        key={r.route_id}
                                        onClick={() => setSelectedRouteId(r.route_id)}
                                        className={`cursor-pointer border-b border-stone-50 transition-colors last:border-0 hover:bg-stone-50 active:bg-brand-mist/60 ${
                                          r.route_id === selectedRouteId ? 'bg-brand-mist/40' : ''
                                        }`}
                                      >
                                        <td className="px-4 py-3 font-medium text-ink">{r.label}</td>
                                        <td className="px-4 py-3 tabular-nums text-stone-600">{r.total_distance_km}</td>
                                        <td className="px-4 py-3 tabular-nums text-stone-600">{Math.round(r.est_travel_time_min)}</td>
                                        <td className="px-4 py-3">
                                          <RiskPill level={riskLevelFor(r.overall_risk_score)} />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}

                          {/* -------- Details tab -------- */}
                          {activeTab === 'details' && (
                            <div className="flex flex-col gap-3">
                              {allRoutes.map((r) => (
                                <RouteAccordion key={r.route_id} route={r} isSelected={r.route_id === selectedRouteId} onSelect={() => setSelectedRouteId(r.route_id)} />
                              ))}
                            </div>
                          )}

                          {/* -------- Risk tab -------- */}
                          {activeTab === 'risk' && selectedRoute && (
                            <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                              <SectionLabel>📊 Top risk segments — {selectedRoute.label}</SectionLabel>
                              <div className="flex flex-col gap-3.5">
                                {riskiestSegments.map((s) => (
                                  <div key={s.segment_id}>
                                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                                      <span className="font-medium text-ink">{s.road_name}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="tabular-nums text-stone-400">{s.risk_score.toFixed(2)}</span>
                                        <RiskPill level={s.risk_level} />
                                      </div>
                                    </div>
                                    <ScoreBar score={s.risk_score} level={s.risk_level} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* -------- Explain tab -------- */}
                          {activeTab === 'explain' && selectedRoute && (
                            <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                              <SectionLabel>⚠️ Risk explanation — {selectedRoute.label}</SectionLabel>
                              {factorsLoading && (
                                <p className="mb-3 flex items-center gap-2 text-xs text-stone-400">
                                  <Spinner className="h-3 w-3" /> Fetching per-segment explanations…
                                </p>
                              )}
                              <div className="flex flex-col gap-4">
                                {selectedRoute.segments
                                  .filter((s) => s.risk_level !== 'Low')
                                  .map((s) => (
                                    <div key={s.segment_id} className="border-l-2 pl-3" style={{ borderColor: RISK_COLORS[s.risk_level] }}>
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-ink">{s.road_name}</p>
                                        <RiskPill level={s.risk_level} />
                                      </div>
                                      <ul className="mt-1.5 flex flex-col gap-1">
                                        {(segmentFactors[s.segment_id] ?? [s.warning ?? 'Elevated risk segment']).map((f, i) => (
                                          <li key={i} className="text-xs text-stone-500">
                                            • {f}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                {selectedRoute.segments.every((s) => s.risk_level === 'Low') && (
                                  <p className="text-xs text-stone-400">✅ No elevated-risk segments on this route — nothing to flag.</p>
                                )}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {routeLoading && (
              <div className="flex flex-col gap-5">
                <div className="skeleton h-16 rounded-2xl" />
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                  <div className="skeleton h-[420px] rounded-2xl lg:col-span-2" />
                  <div className="flex flex-col gap-3 lg:col-span-3">
                    <div className="skeleton h-9 w-64 rounded-full" />
                    <div className="skeleton h-40 rounded-2xl" />
                    <div className="skeleton h-24 rounded-2xl" />
                  </div>
                </div>
              </div>
            )}

            {!routeResult && !routeLoading && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-stone-300 py-16 text-center">
                <p className="text-sm font-medium text-stone-500">🗺️ Pick an origin and destination above to see route options.</p>
                <p className="text-xs text-stone-400">Results — safest route, comparisons, and risk detail — will appear here.</p>
                {places.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginName(places[0].name)
                      setDestName(places[1].name)
                    }}
                    className="mt-1 flex items-center gap-1.5 rounded-full border border-brand-mist bg-brand-mist/40 px-3.5 py-1.5 text-xs font-semibold text-brand-deep transition-all duration-150 ease-spring hover:bg-brand-mist active:scale-95"
                  >
                    ✨ Try {places[0].name} → {places[1].name}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* =========================== Analytics (preserved) =========================== */
          <div>
            {analyticsLoading && (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton h-20 rounded-2xl" />
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton h-64 rounded-2xl" />
                  ))}
                </div>
              </div>
            )}
            {analyticsError && (
              <p className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">⚠️ {analyticsError}</p>
            )}
            {analytics && (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {[
                    { label: '🚨 Total accidents', value: analytics.total_accidents.toLocaleString() },
                    { label: '📊 Avg risk score', value: analytics.avg_risk_score.toFixed(2) },
                    { label: '⏰ Peak-hour share', value: `${Math.round(analytics.peak_hour_share * 100)}%` },
                    { label: '🚦 Intersection share', value: `${Math.round(analytics.intersection_share * 100)}%` },
                    { label: '🌀 Curve share', value: `${Math.round(analytics.curve_share * 100)}%` },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                      <p className="text-2xl font-bold tabular-nums tracking-tight text-ink">{stat.value}</p>
                      <p className="mt-1 text-xs text-stone-400">{stat.label}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                    <SectionLabel>🥧 Severity breakdown</SectionLabel>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={analytics.severity_breakdown} dataKey="count" nameKey="category" innerRadius={50} outerRadius={80} paddingAngle={2}>
                          {analytics.severity_breakdown.map((entry, i) => (
                            <Cell key={entry.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                    <SectionLabel>📈 Monthly trend</SectionLabel>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={analytics.monthly_trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="year_month" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                        <Line type="monotone" dataKey="accident_count" stroke="#16A34A" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                    <SectionLabel>🌦️ By weather condition</SectionLabel>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.weather_breakdown} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis dataKey="category" type="category" width={80} tick={{ fontSize: 11 }} />
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="count" fill="#16A34A" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                    <SectionLabel>🛣️ Riskiest roads (avg. risk score)</SectionLabel>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.top_risky_roads} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                        <YAxis dataKey="category" type="category" width={110} tick={{ fontSize: 10 }} />
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="percentage" name="avg risk" fill="#DC2626" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {[
                    { title: '🕐 By time of day', data: analytics.time_of_day_breakdown },
                    { title: '🛤️ By road type', data: analytics.road_type_breakdown },
                  ].map((block) => (
                    <div key={block.title} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
                      <SectionLabel>{block.title}</SectionLabel>
                      <div className="flex flex-col gap-2.5">
                        {block.data.map((row) => (
                          <div key={row.category}>
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="font-medium text-ink">{row.category}</span>
                              <span className="text-stone-400">{row.percentage}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${row.percentage}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================================
 * RouteAccordion -- used only by the Details tab. Still declared in this
 * same file (not a separate component file); it exists because the
 * expand/collapse state is genuinely per-route and repeating that logic
 * inline for every route in the list would be the actual mess, not this.
 * ==========================================================================*/
function RouteAccordion({ route, isSelected, onSelect }: { route: RouteOption; isSelected: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`rounded-2xl border p-4 shadow-card transition-all duration-150 ${isSelected ? 'border-brand bg-brand-mist/30' : 'border-stone-100 bg-white'}`}>
      <button onClick={onSelect} className="flex w-full items-center justify-between text-left transition-transform duration-150 ease-spring active:scale-[0.98]">
        <div>
          <p className="text-sm font-semibold text-ink">{route.label}</p>
          <p className="mt-0.5 text-xs text-stone-500">{route.summary}</p>
        </div>
        <RiskPill level={riskLevelFor(route.overall_risk_score)} />
      </button>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-semibold text-brand-deep transition-transform duration-150 ease-spring active:scale-95"
      >
        {expanded ? '▲ Hide' : '▼ Show all'} {route.segments.length} segments
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <ol className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3">
              {route.segments.map((s, i) => (
                <li key={s.segment_id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500">
                    {i + 1}. {s.road_name} <span className="text-stone-400">· {s.length_km.toFixed(1)} km</span>
                  </span>
                  <RiskPill level={s.risk_level} />
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
