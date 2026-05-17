import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:8000/api',
  timeout: 10000,
})

// ── TRAMS ─────────────────────────────────────────────────────────────────

export const fetchTramLines = () =>
  api.get('/trams/lines').then(r => r.data)

export const fetchTramStops = () =>
  api.get('/trams/stops').then(r => r.data)

export const fetchTramPositions = () =>
  api.get('/trams/positions').then(r => r.data)

export const fetchDelayProbability = (lineId = null) =>
  api.get('/trams/analytics/delay-probability', { params: lineId ? { line_id: lineId } : {} }).then(r => r.data)

export const fetchReliability = (stopId = null) =>
  api.get('/trams/analytics/reliability', { params: stopId ? { stop_id: stopId } : {} }).then(r => r.data)

export const fetchPunctuality = (lineId = null, hours = 24) =>
  api.get('/trams/analytics/punctuality', { params: { hours, ...(lineId ? { line_id: lineId } : {}) } }).then(r => r.data)

// ── PARKING ───────────────────────────────────────────────────────────────

export const fetchParkingLive = () =>
  api.get('/parking/live').then(r => r.data)

export const fetchParkingZones = () =>
  api.get('/parking/zones').then(r => r.data)

export const fetchParkingOccupancy = (parkingId = null, hours = 24) =>
  api.get('/parking/occupancy', { params: { hours, ...(parkingId ? { parking_id: parkingId } : {}) } }).then(r => r.data)

export const fetchCongestion = () =>
  api.get('/parking/congestion').then(r => r.data)

export const fetchParkingTrend = (parkingId, hours = 48) =>
  api.get(`/parking/trend/${parkingId}`, { params: { hours } }).then(r => r.data)

export default api
