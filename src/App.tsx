/**
 * App.tsx
 *
 * The whole frontend lives in this one file on purpose (no /components,
 * /api, or /types folders) -- types, API calls, and every screen are all
 * here. A handful of tiny presentational helpers (RiskPill, Spinner,
 * SectionLabel) are still declared as local functions below, purely to
 * avoid repeating the same 8-line markup block half a dozen times; they
 * are not a folder/file split.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip, useMapEvents } from 'react-leaflet'
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

/* ============================================================================
 * Types (mirror the FastAPI backend's Pydantic schemas exactly)
 * ==========================================================================*/

type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Night'
type Weather = 'Clear' | 'Rain' | 'Fog' | 'Heavy Rain'
type RiskLevel = 'Low' | 'Medium' | 'High'

interface Place {
  name: string
  latitude: number
  longitude: number
}

interface HealthResponse {
  status: string
  model_loaded: boolean
  accidents_loaded: number
  road_segments_loaded: number
  graph_nodes: number
  graph_edges: number
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
 * API helpers (thin fetch wrappers -- no separate /api folder, per request)
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
 * Tiny presentational helpers -- see file header note above
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
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</div>
}

/** react-leaflet only exposes map clicks via a hook that must run inside a
 * child of <MapContainer> -- this is that unavoidable 4-line wrapper, not
 * an architectural component split. */
function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/* ============================================================================
 * App
 * ==========================================================================*/

export default function App() {
  const [view, setView] = useState<'map' | 'analytics'>('map')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [places, setPlaces] = useState<Place[]>([])

  // Route planner
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')
  const [preferredTime, setPreferredTime] = useState<TimeOfDay>('Afternoon')
  const [weather, setWeather] = useState<Weather>('Clear')
  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)

  // Hotspots layer
  const [showHotspots, setShowHotspots] = useState(false)
  const [hotspots, setHotspots] = useState<Hotspot[]>([])
  const [hotspotsLoading, setHotspotsLoading] = useState(false)

  // Point risk checker
  const [checkPoint, setCheckPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [checkTime, setCheckTime] = useState<TimeOfDay>('Afternoon')
  const [checkWeather, setCheckWeather] = useState<Weather>('Clear')
  const [checkResult, setCheckResult] = useState<RiskResponse | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  // Analytics (fetched on demand, only when that tab is opened)
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  useEffect(() => {
    getPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]))
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    if (view === 'analytics' && !analytics && !analyticsLoading) {
      setAnalyticsLoading(true)
      setAnalyticsError(null)
      getAnalytics()
        .then(setAnalytics)
        .catch((e: unknown) => setAnalyticsError(e instanceof Error ? e.message : 'Could not load analytics.'))
        .finally(() => setAnalyticsLoading(false))
    }
  }, [view, analytics, analyticsLoading])

  const allRoutes = useMemo<RouteOption[]>(
    () => (routeResult ? [routeResult.safest_route, ...routeResult.alternatives] : []),
    [routeResult],
  )
  const selectedRoute = useMemo(
    () => allRoutes.find((r) => r.route_id === selectedRouteId) ?? null,
    [allRoutes, selectedRouteId],
  )

  const handleFindRoute = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const origin = places.find((p) => p.name === originName)
      const dest = places.find((p) => p.name === destName)
      if (!origin || !dest) {
        setRouteError('Pick an origin and a destination first.')
        return
      }
      if (origin.name === dest.name) {
        setRouteError('Origin and destination must be different places.')
        return
      }
      setRouteLoading(true)
      setRouteError(null)
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
      } catch (err) {
        setRouteResult(null)
        setRouteError(err instanceof Error ? err.message : 'Could not compute a route.')
      } finally {
        setRouteLoading(false)
      }
    },
    [places, originName, destName, preferredTime, weather],
  )

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setCheckPoint({ lat, lng })
    setCheckResult(null)
    setCheckError(null)
  }, [])

  const handleCheckRisk = useCallback(async () => {
    if (!checkPoint) return
    setCheckLoading(true)
    setCheckError(null)
    try {
      const result = await postPredictRisk({
        latitude: checkPoint.lat,
        longitude: checkPoint.lng,
        time_of_day: checkTime,
        weather_condition: checkWeather,
      })
      setCheckResult(result)
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Could not check this point.')
    } finally {
      setCheckLoading(false)
    }
  }, [checkPoint, checkTime, checkWeather])

  const toggleHotspots = useCallback(async () => {
    const next = !showHotspots
    setShowHotspots(next)
    if (next && hotspots.length === 0) {
      setHotspotsLoading(true)
      try {
        const data = await getHotspots(15)
        setHotspots(data.hotspots)
      } catch {
        // Hotspots are a supplementary layer -- fail quietly, core flow is unaffected.
      } finally {
        setHotspotsLoading(false)
      }
    }
  }, [showHotspots, hotspots.length])

  return (
    <div className="flex h-screen flex-col bg-canvas">
      {/* ---------------------------- Top nav ---------------------------- */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">P</div>
          <div>
            <h1 className="text-base font-bold leading-tight tracking-tight text-ink">Peddapalli SafeRoute</h1>
            <p className="hidden text-xs leading-tight text-slate-400 sm:block">Accident risk & safest-route planning</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <nav className="flex rounded-full bg-slate-100 p-1 text-sm font-medium">
            <button
              onClick={() => setView('map')}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                view === 'map' ? 'bg-white text-brand-deep shadow-card' : 'text-slate-500 hover:text-ink'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setView('analytics')}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                view === 'analytics' ? 'bg-white text-brand-deep shadow-card' : 'text-slate-500 hover:text-ink'
              }`}
            >
              Analytics
            </button>
          </nav>
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
              health?.status === 'ok' ? 'bg-brand-mist text-brand-deep' : 'bg-slate-100 text-slate-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${health?.status === 'ok' ? 'bg-brand' : 'bg-slate-300'}`} />
            {health?.status === 'ok' ? 'API connected' : 'API offline'}
          </span>
        </div>
      </header>

      {/* ------------------------------ Body ------------------------------ */}
      {view === 'map' ? (
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* -------- Map -------- */}
          <div className="relative h-[46vh] flex-shrink-0 lg:h-auto lg:flex-1">
            <MapContainer center={PEDDAPALLI_CENTER} zoom={12} className="h-full w-full">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <ClickCapture onClick={handleMapClick} />

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
                        <p className="text-slate-500">{s.warning ?? `${s.risk_level} risk segment`}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}

              {routeResult && (
                <>
                  <CircleMarker
                    center={routeResult.origin}
                    radius={9}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#16A34A', fillOpacity: 1 }}
                  >
                    <Tooltip permanent direction="top" offset={[0, -8]}>
                      Origin
                    </Tooltip>
                  </CircleMarker>
                  <CircleMarker
                    center={routeResult.destination}
                    radius={9}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#0F172A', fillOpacity: 1 }}
                  >
                    <Tooltip permanent direction="top" offset={[0, -8]}>
                      Destination
                    </Tooltip>
                  </CircleMarker>
                </>
              )}

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
                        <p className="text-slate-500">
                          {h.accident_count} accidents &middot; avg risk {h.avg_risk_score.toFixed(2)}
                        </p>
                        <p className="text-slate-500">
                          Mostly {h.dominant_severity.toLowerCase()} severity, {h.dominant_weather.toLowerCase()}, {h.dominant_time_of_day.toLowerCase()}
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

            <button
              onClick={toggleHotspots}
              className={`absolute right-3 top-3 z-[1000] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-card transition-colors ${
                showHotspots ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-brand-mist'
              }`}
            >
              {hotspotsLoading ? <Spinner className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current" />}
              Hotspots
            </button>
          </div>

          {/* -------- Sidebar -------- */}
          <aside className="thin-scroll flex w-full flex-col gap-4 overflow-y-auto border-t border-slate-200 bg-white p-4 lg:h-auto lg:w-[400px] lg:flex-shrink-0 lg:border-l lg:border-t-0 lg:p-5">
            {/* Route planner */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
              <SectionLabel>Plan a route</SectionLabel>
              <form onSubmit={handleFindRoute} className="flex flex-col gap-3">
                <select
                  value={originName}
                  onChange={(e) => setOriginName(e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                >
                  <option value="">Origin&hellip;</option>
                  {places.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={destName}
                  onChange={(e) => setDestName(e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                >
                  <option value="">Destination&hellip;</option>
                  {places.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value as TimeOfDay)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    value={weather}
                    onChange={(e) => setWeather(e.target.value as Weather)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  >
                    {WEATHER_OPTIONS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={routeLoading}
                  className="flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
                >
                  {routeLoading && <Spinner />}
                  Find safest route
                </button>
                {routeError && <p className="text-xs font-medium text-red-600">{routeError}</p>}
              </form>
            </div>

            {/* Route results */}
            {routeResult && (
              <div className="flex flex-col gap-2.5">
                <SectionLabel>Route comparison</SectionLabel>
                {routeResult.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{routeResult.warnings[0]}</div>
                )}
                {allRoutes.map((route) => {
                  const isSelected = route.route_id === selectedRouteId
                  return (
                    <button
                      key={route.route_id}
                      onClick={() => setSelectedRouteId(route.route_id)}
                      className={`rounded-2xl border p-3.5 text-left shadow-card transition-all ${
                        isSelected ? 'border-brand bg-brand-mist/40 ring-1 ring-brand' : 'border-slate-100 bg-white hover:border-brand-mist'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">{route.label}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{route.summary}</p>
                        </div>
                        <RiskPill level={riskLevelFor(route.overall_risk_score)} />
                      </div>
                      <div className="mt-2.5 flex gap-4 text-xs text-slate-500">
                        <span>{route.total_distance_km} km</span>
                        <span>{Math.round(route.est_travel_time_min)} min</span>
                        {route.high_risk_segment_count > 0 && (
                          <span className="font-medium text-red-600">
                            {route.high_risk_segment_count} high-risk segment{route.high_risk_segment_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
                <p className="px-1 text-xs leading-relaxed text-slate-500">{routeResult.explanation}</p>
              </div>
            )}

            {/* Point risk checker */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
              <SectionLabel>Check risk at a point</SectionLabel>
              {!checkPoint ? (
                <p className="text-xs text-slate-400">Click anywhere on the map to check the risk there.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-slate-400">
                    {checkPoint.lat.toFixed(4)}, {checkPoint.lng.toFixed(4)}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={checkTime}
                      onChange={(e) => setCheckTime(e.target.value as TimeOfDay)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      value={checkWeather}
                      onChange={(e) => setCheckWeather(e.target.value as Weather)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-mist"
                    >
                      {WEATHER_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleCheckRisk}
                    disabled={checkLoading}
                    className="flex items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                  >
                    {checkLoading && <Spinner />}
                    Check risk
                  </button>
                  {checkError && <p className="text-xs font-medium text-red-600">{checkError}</p>}
                  {checkResult && (
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-ink">{checkResult.risk_score.toFixed(2)}</span>
                        <RiskPill level={checkResult.risk_level} />
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{checkResult.explanation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : (
        /* ---------------------------- Analytics ---------------------------- */
        <div className="thin-scroll flex-1 overflow-y-auto p-4 sm:p-6">
          {analyticsLoading && (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {analyticsError && <p className="text-sm font-medium text-red-600">{analyticsError}</p>}
          {analytics && (
            <div className="mx-auto flex max-w-6xl flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  { label: 'Total accidents', value: analytics.total_accidents.toLocaleString() },
                  { label: 'Avg risk score', value: analytics.avg_risk_score.toFixed(2) },
                  { label: 'Peak-hour share', value: `${Math.round(analytics.peak_hour_share * 100)}%` },
                  { label: 'Intersection share', value: `${Math.round(analytics.intersection_share * 100)}%` },
                  { label: 'Curve share', value: `${Math.round(analytics.curve_share * 100)}%` },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                    <p className="text-2xl font-bold tracking-tight text-ink">{stat.value}</p>
                    <p className="mt-1 text-xs text-slate-400">{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                  <SectionLabel>Severity breakdown</SectionLabel>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={analytics.severity_breakdown} dataKey="count" nameKey="category" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {analytics.severity_breakdown.map((entry, i) => (
                          <Cell key={entry.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                  <SectionLabel>Monthly trend</SectionLabel>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={analytics.monthly_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="year_month" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Line type="monotone" dataKey="accident_count" stroke="#16A34A" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                  <SectionLabel>By weather condition</SectionLabel>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={analytics.weather_breakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" width={80} tick={{ fontSize: 11 }} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#16A34A" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                  <SectionLabel>Riskiest roads (avg. risk score)</SectionLabel>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={analytics.top_risky_roads} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" width={110} tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Bar dataKey="percentage" name="avg risk" fill="#DC2626" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {[
                  { title: 'By time of day', data: analytics.time_of_day_breakdown },
                  { title: 'By road type', data: analytics.road_type_breakdown },
                ].map((block) => (
                  <div key={block.title} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
                    <SectionLabel>{block.title}</SectionLabel>
                    <div className="flex flex-col gap-2.5">
                      {block.data.map((row) => (
                        <div key={row.category}>
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="font-medium text-ink">{row.category}</span>
                            <span className="text-slate-400">{row.percentage}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
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
  )
}
