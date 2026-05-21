import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useTransportStore } from '../../store/useTransportStore'

// ── Constants ────────────────────────────────────────────────────────────────
const CENTER  = [5.7245, 45.1875]
const ZOOM    = 13
const POLL_MS = 10_000   // must match backend Redis TTL

// ── Math helpers ─────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => {
  const d = ((b - a + 540) % 360) - 180
  return (a + d * t + 360) % 360
}
const emptyFC = () => ({ type: 'FeatureCollection', features: [] })

// ── Component ────────────────────────────────────────────────────────────────
export default function TransportMap({ showParking }) {
  const containerRef = useRef(null)

  // All mutable map state lives in a ref — never triggers re-renders
  const s = useRef({
    map:       null,
    ready:     false,
    rafId:     null,
    // id -> { fromLon, fromLat, fromHeading, toLon, toLat, toHeading,
    //         curLon, curLat, curHeading, startTime, color, code }
    trams:     {},
    // Hold latest prop values accessible inside the RAF loop and map callbacks
    showParking: false,
  }).current

  const {
    tramLines, tramStops, tramPositions, parkingLive,
    selectedLine, setSelectedLine, setSelectedParking,
  } = useTransportStore()

  // ── Map init — runs once ─────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center:    CENTER,
      zoom:      ZOOM,
      attributionControl: false,
    })
    s.map = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    // Resize whenever the flex container changes size (handles 0×0 on first paint)
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    map.once('load', () => {
      map.resize()
      setupSources(map)
      setupLayers(map, s, setSelectedLine, setSelectedParking)
      s.ready = true

      // Flush any data that arrived before the map was ready
      const st = useTransportStore.getState()
      applyLines(map, st.tramLines, st.selectedLine)
      applyStops(map, st.tramStops)
      applyParking(map, st.parkingLive, s.showParking)
      syncPositions(s, st.tramPositions)
    })

    // ── Animation loop ───────────────────────────────────────────────────
    // Interpolates tram positions between backend polls.
    // Updates a GeoJSON source every frame — MapLibre re-renders automatically.
    const loop = (ts) => {
      s.rafId = requestAnimationFrame(loop)
      if (!s.ready) return
      const entries = Object.values(s.trams)
      if (!entries.length) return

      const features = entries.map(t => {
        const p       = Math.min((ts - t.startTime) / POLL_MS, 1)
        t.curLon      = lerp(t.fromLon, t.toLon, p)
        t.curLat      = lerp(t.fromLat, t.toLat, p)
        t.curHeading  = lerpAngle(t.fromHeading, t.toHeading, p)
        return {
          type: 'Feature',
          properties: { color: t.color, heading: t.curHeading, code: t.code },
          geometry:   { type: 'Point', coordinates: [t.curLon, t.curLat] },
        }
      })

      map.getSource('trams')?.setData({ type: 'FeatureCollection', features })
    }
    s.rafId = requestAnimationFrame(loop)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(s.rafId)
      map.remove()
      s.map   = null
      s.ready = false
      s.trams = {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync props → map ─────────────────────────────────────────────────────
  useEffect(() => {
    if (s.ready) applyLines(s.map, tramLines, selectedLine)
  }, [tramLines, selectedLine])

  useEffect(() => {
    if (s.ready) applyStops(s.map, tramStops)
  }, [tramStops])

  useEffect(() => {
    s.showParking = showParking
    if (s.ready) applyParking(s.map, parkingLive, showParking)
  }, [parkingLive, showParking])

  useEffect(() => {
    if (s.ready) syncPositions(s, tramPositions)
  }, [tramPositions])

  useEffect(() => {
    if (!s.ready) return

    // Parking
    const parkingVisibility = showParking ? 'visible' : 'none'
    s.map.setLayoutProperty('parking', 'visibility', parkingVisibility)

    // Lines
    const linesVisibility = showParking ? 'none' : 'visible'
    s.map.setLayoutProperty('lines', 'visibility', linesVisibility)
    s.map.setLayoutProperty('stops', 'visibility', linesVisibility)
    s.map.setLayoutProperty('lines-bg', 'visibility', linesVisibility)
  }, [showParking])

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0 }}
    />
  )
}

// ── Map setup ────────────────────────────────────────────────────────────────

function setupSources(map) {
  map.addSource('lines',   { type: 'geojson', data: emptyFC() })
  map.addSource('stops',   { type: 'geojson', data: emptyFC() })
  map.addSource('parking', { type: 'geojson', data: emptyFC() })
  map.addSource('trams',   { type: 'geojson', data: emptyFC() })
}

function setupLayers(map, s, setSelectedLine, setSelectedParking) {
  // ── Tram lines ──────────────────────────────────────────────────────────
  map.addLayer({
    id: 'lines-bg', type: 'line', source: 'lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color':   ['get', 'color'],
      'line-width':   5,
      'line-opacity': 0.25,
      'line-blur':    2,
    },
  })
  map.addLayer({
    id: 'lines', type: 'line', source: 'lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color':   ['get', 'color'],
      'line-width':   ['case', ['boolean', ['get', 'selected'], false], 5, 3],
      'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 1, 0.6],
    },
  })
  map.on('click', 'lines', e => {
    const id    = e.features[0].properties.id
    const store = useTransportStore.getState()
    const cur   = store.selectedLine
    store.setSelectedLine(cur?.id === id ? null : store.tramLines.find(l => l.id === id))
  })
  map.on('mouseenter', 'lines', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'lines', () => { map.getCanvas().style.cursor = '' })

  // ── Stops ───────────────────────────────────────────────────────────────
  map.addLayer({
    id: 'stops', type: 'circle', source: 'stops', minzoom: 13,
    paint: {
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 13, 3, 16, 6],
      'circle-color':        '#0f172a',
      'circle-stroke-color': '#e2e8f0',
      'circle-stroke-width': 1.5,
    },
  })

  // ── Parking ─────────────────────────────────────────────────────────────
  map.addLayer({
    id: 'parking', type: 'circle', source: 'parking',
    paint: {
      'circle-radius':       10,
      'circle-color':        ['get', 'color'],
      'circle-opacity':      0.85,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  })
  map.addLayer({
    id: 'parking-count', type: 'symbol', source: 'parking',
    layout: {
      'text-field':            ['get', 'label'],
      'text-size':             10,
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.3)', 'text-halo-width': 1 },
  })
  map.on('click', 'parking', e => {
    setSelectedParking(e.features[0].properties)
  })
  map.on('mouseenter', 'parking', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'parking', () => { map.getCanvas().style.cursor = '' })

  // ── Trams ───────────────────────────────────────────────────────────────
  // Outer glow
  map.addLayer({
    id: 'trams-glow', type: 'circle', source: 'trams',
    paint: {
      'circle-radius':   18,
      'circle-color':    ['get', 'color'],
      'circle-opacity':  0.2,
      'circle-blur':     1,
    },
  })
  // Main circle
  map.addLayer({
    id: 'trams-circle', type: 'circle', source: 'trams',
    paint: {
      'circle-radius':       11,
      'circle-color':        ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    },
  })
  // Direction arrow — rotated text symbol, aligned to map north
  map.addLayer({
    id: 'trams-arrow', type: 'symbol', source: 'trams',
    layout: {
      'text-field':               '▲',
      'text-size':                9,
      'text-rotate':              ['get', 'heading'],
      'text-rotation-alignment':  'map',
      'text-pitch-alignment':     'map',
      'text-allow-overlap':       true,
      'text-ignore-placement':    true,
      'text-offset':              [0, -1.6],
    },
    paint: { 'text-color': '#ffffff', 'text-opacity': 0.95 },
  })
  // Line code label
  map.addLayer({
    id: 'trams-label', type: 'symbol', source: 'trams',
    layout: {
      'text-field':            ['get', 'code'],
      'text-size':             9,
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.4)', 'text-halo-width': 1 },
  })
}

// ── Data update functions ─────────────────────────────────────────────────────

function applyLines(map, lines, selectedLine) {
  if (!lines?.length) return
  map.getSource('lines')?.setData({
    type: 'FeatureCollection',
    features: lines.flatMap(l => {
      if (!l.geometry) return []
      const props = {
        id:       l.id,
        color:    l.color || '#888888',
        selected: selectedLine?.id === l.id,
      }
      const geom = l.geometry
      // MultiLineString: emit one Feature per segment so each segment renders independently
      if (geom.type === 'MultiLineString') {
        return geom.coordinates.map(seg => ({
          type: 'Feature',
          properties: props,
          geometry: { type: 'LineString', coordinates: seg },
        }))
      }
      return [{ type: 'Feature', properties: props, geometry: geom }]
    }),
  })
}

function applyStops(map, stops) {
  if (!stops?.length) return
  map.getSource('stops')?.setData({
    type: 'FeatureCollection',
    features: stops.map(st => ({
      type: 'Feature',
      properties: { id: st.id, name: st.name },
      geometry:   { type: 'Point', coordinates: [st.lon, st.lat] },
    })),
  })
}

function applyParking(map, parking, show) {
  if (!show || !parking?.length) {
    map.getSource('parking')?.setData(emptyFC())
    return
  }
  map.getSource('parking')?.setData({
    type: 'FeatureCollection',
    features: parking
      .filter(p => p.lat && p.lon)
      .map(p => {
        const pct = p.occupancy_pct ?? 0
        const color = pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#22c55e'
        return {
          type: 'Feature',
          properties: {
            id:    p.id,
            name:  p.name,
            color,
            label: p.available != null ? String(p.available) : '',
          },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        }
      }),
  })
}

function syncPositions(s, positions) {
  if (!positions?.length) return
  const now  = performance.now()
  const seen = new Set()

  for (const t of positions) {
    const id = `${t.line_id}_${t.trip_id}`
    seen.add(id)
    const ex = s.trams[id]

    if (!ex) {
      s.trams[id] = {
        code: t.line_code, color: t.color || '#888888',
        fromLon: t.lon, fromLat: t.lat, fromHeading: t.heading,
        toLon:   t.lon, toLat:   t.lat, toHeading:   t.heading,
        curLon:  t.lon, curLat:  t.lat, curHeading:  t.heading,
        startTime: now,
      }
    } else {
      // Animate from where we currently are to the new reported position
      ex.fromLon     = ex.curLon
      ex.fromLat     = ex.curLat
      ex.fromHeading = ex.curHeading
      ex.toLon       = t.lon
      ex.toLat       = t.lat
      ex.toHeading   = t.heading
      ex.startTime   = now
    }
  }

  // Remove stale trams
  for (const id of Object.keys(s.trams)) {
    if (!seen.has(id)) delete s.trams[id]
  }
}