import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useTransportStore } from '../../store/useTransportStore'
import 'leaflet/dist/leaflet.css'

// Grenoble center
const GRENOBLE = [45.1875, 5.7245]
const DEFAULT_ZOOM = 13

// Create a custom tram icon from a colored circle SVG
function makeTramIcon(color, heading) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="11" fill="${color}" stroke="white" stroke-width="2.5"/>
      <text x="14" y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="white">T</text>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function TramLayers() {
  const { tramLines, tramStops, tramPositions, selectedLine, setSelectedLine } = useTransportStore()

  return (
    <>
      {/* Line polylines */}
      {tramLines.map(line => {
        if (!line.geometry?.coordinates) return null
        const coords = line.geometry.coordinates.map(([lon, lat]) => [lat, lon])
        const isSelected = selectedLine?.id === line.id
        return (
          <Polyline
            key={line.id}
            positions={coords}
            pathOptions={{
              color: line.color || '#888',
              weight: isSelected ? 6 : 3,
              opacity: isSelected ? 1 : 0.6,
            }}
            eventHandlers={{ click: () => setSelectedLine(isSelected ? null : line) }}
          />
        )
      })}

      {/* Stops */}
      {tramStops.slice(0, 300).map(stop => (
        <CircleMarker
          key={stop.id}
          center={[stop.lat, stop.lon]}
          radius={4}
          pathOptions={{ color: '#ffffff', fillColor: '#334155', fillOpacity: 1, weight: 1.5 }}
        >
          <Popup>
            <strong>{stop.name}</strong>
            <br />
            <small>{stop.id}</small>
          </Popup>
        </CircleMarker>
      ))}

      {/* Animated tram positions */}
      {tramPositions.map((tram, i) => (
        <Marker
          key={`${tram.line_id}-${tram.trip_id ?? i}`}
          position={[tram.lat, tram.lon]}
          icon={makeTramIcon(tram.color || '#888', tram.heading)}
        >
          <Popup>
            <strong>Ligne {tram.line_code}</strong>
            {tram.destination && <> → {tram.destination}</>}
            <br />
            {tram.delay_s > 60
              ? <span style={{ color: '#ef4444' }}>Retard: {Math.round(tram.delay_s / 60)} min</span>
              : <span style={{ color: '#22c55e' }}>À l'heure</span>}
            <br />
            <small>Progression: {Math.round(tram.progress * 100)}%</small>
          </Popup>
        </Marker>
      ))}
    </>
  )
}

export default function TransportMap({ showParking }) {
  return (
    <MapContainer
      center={GRENOBLE}
      zoom={DEFAULT_ZOOM}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
      />
      <TramLayers />
      {showParking && <ParkingLayer />}
    </MapContainer>
  )
}

// Parking markers (rendered only when parking tab active)
function ParkingLayer() {
  const { parkingLive, setSelectedParking } = useTransportStore()

  return parkingLive.map(p => {
    if (!p.lat || !p.lon) return null
    const pct = p.occupancy_pct ?? 0
    const color = pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#22c55e'
    return (
      <CircleMarker
        key={p.id}
        center={[p.lat, p.lon]}
        radius={10}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.75, weight: 2 }}
        eventHandlers={{ click: () => setSelectedParking(p) }}
      >
        <Popup>
          <strong>{p.name}</strong>
          <br />
          {p.available ?? '?'} places disponibles
          <br />
          Taux: {pct.toFixed(0)}%
          {p.is_congested && <><br /><span style={{ color: '#ef4444' }}>⚠ Congestionné</span></>}
        </Popup>
      </CircleMarker>
    )
  })
}
