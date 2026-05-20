import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTransportStore } from '../../store/useTransportStore'

const GRENOBLE = [5.7245, 45.1875]
const POLL_MS = 10000

function lerp(a, b, t) { return a + (b - a) * t }
function lerpAngle(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

export default function TransportMap({ showParking }) {
  const containerRef = useRef(null)
  const stateRef = useRef({
    map: null,
    ready: false,
    markers: {},   // id -> { marker, el, from, to, startTime }
    rafId: null,
    pendingPositions: null,
    pendingParking: null,
    pendingLines: null,
    pendingStops: null,
  })

  const { tramLines, tramStops, tramPositions, parkingLive, selectedLine, setSelectedLine, setSelectedParking } = useTransportStore()

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: GRENOBLE,
      zoom: 13,
      attributionControl: false,
    })
    s.map = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.once('load', () => {
      // Add sources
      map.addSource('lines',   { type: 'geojson', data: empty() })
      map.addSource('stops',   { type: 'geojson', data: empty() })
      map.addSource('parking', { type: 'geojson', data: empty() })

      // Line layer
      map.addLayer({
        id: 'lines', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'sel'], 6, 3],
          'line-opacity': ['case', ['get', 'sel'], 1, 0.55],
        },
      })
      map.on('click', 'lines', e => {
        const id = e.features[0].properties.id
        const store = useTransportStore.getState()
        store.setSelectedLine(store.selectedLine?.id === id ? null : store.tramLines.find(l => l.id === id))
      })

      // Stop layer
      map.addLayer({
        id: 'stops', type: 'circle', source: 'stops', minzoom: 13,
        paint: { 'circle-radius': 4, 'circle-color': '#1e293b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      })

      // Parking layer
      map.addLayer({
        id: 'parking', type: 'circle', source: 'parking',
        paint: {
          'circle-radius': 10,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.8,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      })
      map.addLayer({
        id: 'parking-labels', type: 'symbol', source: 'parking',
        layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': '#fff' },
      })
      map.on('click', 'parking', e => {
        useTransportStore.getState().setSelectedParking(e.features[0].properties)
      })

      s.ready = true

      // Flush any data that arrived before map was ready
      if (s.pendingLines)    applyLines(s, s.pendingLines, s.pendingSelectedLine)
      if (s.pendingStops)    applyStops(s, s.pendingStops)
      if (s.pendingParking !== null) applyParking(s, s.pendingParking, s.pendingShowParking)
      if (s.pendingPositions) applyPositions(s, s.pendingPositions)
    })

    // Animation loop
    const loop = (ts) => {
      s.rafId = requestAnimationFrame(loop)
      Object.values(s.markers).forEach(m => {
        const t = Math.min((ts - m.startTime) / POLL_MS, 1)
        m.marker.setLngLat([lerp(m.from.lon, m.to.lon, t), lerp(m.from.lat, m.to.lat, t)])
        if (m.el) m.el.style.transform = `rotate(${lerpAngle(m.from.heading, m.to.heading, t)}deg)`
      })
    }
    s.rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(s.rafId)
      Object.values(s.markers).forEach(m => m.marker.remove())
      map.remove()
      s.map = null
      s.ready = false
    }
  }, [])

  // ── Push data to map (or queue if not ready) ──────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (s.ready) applyLines(s, tramLines, selectedLine)
    else { s.pendingLines = tramLines; s.pendingSelectedLine = selectedLine }
  }, [tramLines, selectedLine])

  useEffect(() => {
    const s = stateRef.current
    if (s.ready) applyStops(s, tramStops)
    else s.pendingStops = tramStops
  }, [tramStops])

  useEffect(() => {
    const s = stateRef.current
    if (s.ready) applyParking(s, parkingLive, showParking)
    else { s.pendingParking = parkingLive; s.pendingShowParking = showParking }
  }, [parkingLive, showParking])

  useEffect(() => {
    const s = stateRef.current
    if (s.ready) applyPositions(s, tramPositions)
    else s.pendingPositions = tramPositions
  }, [tramPositions])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

// ── Pure functions that touch the map ────────────────────────────────────────

function empty() { return { type: 'FeatureCollection', features: [] } }

function applyLines(s, lines, selected) {
  s.map.getSource('lines')?.setData({
    type: 'FeatureCollection',
    features: lines.filter(l => l.geometry).map(l => ({
      type: 'Feature',
      properties: { id: l.id, color: l.color || '#888', sel: selected?.id === l.id },
      geometry: l.geometry,
    })),
  })
}

function applyStops(s, stops) {
  s.map.getSource('stops')?.setData({
    type: 'FeatureCollection',
    features: stops.map(st => ({
      type: 'Feature',
      properties: { id: st.id, name: st.name },
      geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
    })),
  })
}

function applyParking(s, parking, show) {
  if (!show) { s.map.getSource('parking')?.setData(empty()); return }
  s.map.getSource('parking')?.setData({
    type: 'FeatureCollection',
    features: parking.filter(p => p.lat && p.lon).map(p => {
      const pct = p.occupancy_pct ?? 0
      return {
        type: 'Feature',
        properties: {
          id: p.id, name: p.name,
          color: pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#22c55e',
          label: p.available != null ? String(p.available) : '',
        },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }
    }),
  })
}

function applyPositions(s, positions) {
  const now = performance.now()
  const seen = new Set()

  positions.forEach(t => {
    const id = `${t.line_id}_${t.trip_id}`
    seen.add(id)
    const existing = s.markers[id]

    if (!existing) {
      const el = makeTramEl(t.color, t.heading, t.line_code)
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([t.lon, t.lat])
        .addTo(s.map)
      s.markers[id] = { marker, el, from: t, to: t, startTime: now }
    } else {
      const cur = existing.marker.getLngLat()
      const curHeading = lerpAngle(existing.from.heading, existing.to.heading,
        Math.min((now - existing.startTime) / POLL_MS, 1))
      existing.from = { lat: cur.lat, lon: cur.lng, heading: curHeading }
      existing.to   = { lat: t.lat,  lon: t.lon,  heading: t.heading }
      existing.startTime = now
    }
  })

  // Remove gone trams
  Object.keys(s.markers).forEach(id => {
    if (!seen.has(id)) { s.markers[id].marker.remove(); delete s.markers[id] }
  })
}

function makeTramEl(color, heading, code) {
  const el = document.createElement('div')
  el.style.cssText = `width:28px;height:28px;transform:rotate(${heading}deg)`
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <circle cx="14" cy="14" r="11" fill="${color||'#888'}" stroke="white" stroke-width="2"/>
    <polygon points="14,3 11,9 17,9" fill="white" opacity="0.9"/>
    <text x="14" y="19" text-anchor="middle" font-size="9" font-weight="bold"
          fill="white" font-family="sans-serif">${code}</text>
  </svg>`
  return el
}