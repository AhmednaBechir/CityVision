import { useEffect, useRef, useState } from 'react'
import * as turfNearest from '@turf/nearest-point-on-line'
import * as turfAlong from '@turf/along'
import * as turfLength from '@turf/length'
import { lineString, multiLineString } from '@turf/helpers'

// Flatten MultiLineString coords into single LineString
function flattenGeometry(geometry) {
  const features = geometry?.features || []
  if (!features.length) return null
  const coords = features[0].geometry.coordinates
  // MultiLineString: array of arrays of coords
  const flat = coords.flat ? coords.flat(1) : [].concat(...coords)
  return lineString(flat)
}

// Project a stop [lon, lat] onto the line, return distance from start in km
function projectStop(line, stop) {
  const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] } }
  const nearest = turfNearest.default(line, pt)
  return nearest.properties.location // km from start
}

// now_s: seconds since midnight Europe/Paris
function getNowSeconds() {
  const now = new Date()
  // get Paris time
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  return paris.getHours() * 3600 + paris.getMinutes() * 60 + paris.getSeconds()
}

export function useTramAnimation(tramLines, selectedLine, scheduleData) {
  const [tramPositions, setTramPositions] = useState([]) // [{lon, lat, lineId, color}]
  const rafRef = useRef(null)
  const dataRef = useRef(null)

  useEffect(() => {
    if (!tramLines.length || !selectedLine || !scheduleData) return

    const line = tramLines.find(l => l.id === selectedLine)
    if (!line?.geometry) return

    const flatLine = flattenGeometry(line.geometry)
    if (!flatLine) return

    const totalLength = turfLength.default(flatLine) // km

    // Project all stops onto the line
    const stops = scheduleData['0']?.arrets || []
    if (stops.length < 2) return

    // Project each stop — geometry may be reversed
    const projected = stops.map(stop => ({
      ...stop,
      dist: projectStop(flatLine, stop)
    }))

    // Check if geometry is reversed (first stop should have smaller dist if forward)
    const isReversed = projected[0].dist > projected[projected.length - 1].dist

    // Normalize: make distances go 0→totalLength in trip direction
    const normalizedStops = projected.map(s => ({
      ...s,
      dist: isReversed ? totalLength - s.dist : s.dist
    }))

    dataRef.current = { flatLine, normalizedStops, totalLength, isReversed, line }

    const color = '#' + (line.color || 'ffffff')

    function animate() {
      const now_s = getNowSeconds()
      const { flatLine, normalizedStops, totalLength, isReversed } = dataRef.current
      const positions = []

      // Find all active trips
      // A trip is active if now_s is between departure at stop[i] and stop[i+1]
      // trips array: each stop has trips[] = departure times at that stop
      // We need to find trams currently between stops

      const numTrips = normalizedStops[0]?.trips?.length || 0

      for (let tripIdx = 0; tripIdx < numTrips; tripIdx++) {
        // Find which segment this trip is on right now
        for (let i = 0; i < normalizedStops.length - 1; i++) {
          const stopA = normalizedStops[i]
          const stopB = normalizedStops[i + 1]

          const depA = stopA.trips?.[tripIdx]
          const depB = stopB.trips?.[tripIdx]

          if (!depA || !depB) continue

          const tA = typeof depA === 'string' ? parseInt(depA) : depA
          const tB = typeof depB === 'string' ? parseInt(depB) : depB

          if (isNaN(tA) || isNaN(tB)) continue

          if (now_s >= tA && now_s < tB) {
            // Tram is between stopA and stopB
            const frac = (now_s - tA) / (tB - tA)
            const dist = stopA.dist + frac * (stopB.dist - stopA.dist)

            // Clamp
            const clampedDist = Math.max(0, Math.min(totalLength, dist))

            // Get actual coordinate along line
            const actualDist = isReversed ? totalLength - clampedDist : clampedDist
            const pt = turfAlong.default(flatLine, actualDist)

            positions.push({
              lon: pt.geometry.coordinates[0],
              lat: pt.geometry.coordinates[1],
              lineId: selectedLine,
              color,
              tripIdx,
              stopA: stopA.stopName,
              stopB: stopB.stopName,
            })
            break
          }
        }
      }

      setTramPositions(positions)
      rafRef.current = setTimeout(animate, 1000) // update every second
    }

    animate()
    return () => clearTimeout(rafRef.current)
  }, [tramLines, selectedLine, scheduleData])

  return tramPositions
}