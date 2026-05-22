import React, { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useStore } from '../store'
import { fetchSchedule } from '../api'

export default function MapView() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])            // Tram stop markers
  const parkingMarkersRef = useRef([])     // Parking markers

  const { tramLines, parking, selectedLine, setSelectedStop, viewMode } = useStore()

  // Initialize map
  useEffect(() => {
    mapInstance.current = new maplibregl.Map({
      container: mapRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [5.7245, 45.1885],
      zoom: 13,
    })
    mapInstance.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    return () => mapInstance.current?.remove()
  }, [])

  // Draw tram lines
  useEffect(() => {
    const map = mapInstance.current
    if (!map || !tramLines.length) return

    const draw = () => {
      tramLines.forEach(line => {
        if (!line.geometry) return
        const id = `tram-${line.id}`
        const color = '#' + (line.color || 'ffffff')
        const isSelected = selectedLine === line.id

        if (map.getSource(id)) {
          map.setPaintProperty(id, 'line-width', isSelected ? 6 : 3)
          map.setPaintProperty(id, 'line-opacity', isSelected ? 1 : 0.5)
        } else {
          map.addSource(id, { type: 'geojson', data: line.geometry })
          map.addLayer({
            id,
            type: 'line',
            source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.7 }
          })
        }

        // Set visibility based on viewMode
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', viewMode === 'trams' ? 'visible' : 'none')
        }
      })
    }

    if (map.isStyleLoaded()) draw()
    else map.on('load', draw)
  }, [tramLines, selectedLine, viewMode])

  // Draw stop markers when a line is selected
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    // Clear old stop markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    if (!selectedLine) return

    const lineId = selectedLine.replace(':', '_')
    fetchSchedule(lineId).then(data => {
      const stops = data['0']?.arrets || []
      const line = tramLines.find(l => l.id === selectedLine)
      const color = '#' + (line?.color || 'ffffff')

      stops.forEach(stop => {
        const el = document.createElement('div')
        el.style.cssText = `
          width: 14px; height: 14px; border-radius: 50%;
          background: white; border: 2px solid ${color};
          cursor: pointer; z-index: 999;
          visibility: ${viewMode === 'trams' ? 'visible' : 'hidden'};
        `
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setSelectedStop(stop)
        })

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([stop.lon, stop.lat])
          .addTo(map)

        markersRef.current.push(marker)
      })
    }).catch(console.error)
  }, [selectedLine, tramLines, setSelectedStop, viewMode])

  // Toggle stop markers visibility on viewMode change
  useEffect(() => {
    markersRef.current.forEach(m => {
      m.getElement().style.visibility = viewMode === 'trams' ? 'visible' : 'hidden'
    })
  }, [viewMode])

  // Draw parking markers
  useEffect(() => {
    const map = mapInstance.current
    if (!map || !parking.length) return

    const addMarkers = () => {
      // Clear old
      parkingMarkersRef.current.forEach(({ marker }) => marker.remove())
      parkingMarkersRef.current = []

      parking.filter(p => p.lat && p.lon && p.has_sensor).forEach(p => {
        const pct = p.total > 0 ? p.free / p.total : 0
        const color = pct > 0.4 ? '#4caf50' : pct > 0.15 ? '#ff9800' : '#f44336'

        const el = document.createElement('div')
        el.style.cssText = `
          width: 18px; height: 18px; border-radius: 50%;
          background: ${color}; border: 3px solid #fff;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: bold; color: white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          visibility: ${viewMode === 'parking' ? 'visible' : 'hidden'};
        `

        const popup = new maplibregl.Popup({ offset: 14 })
          .setHTML(`<div style="font-size:12px;color:#000"><b>${p.name}</b><br/>Free: ${p.free} / ${p.total}</div>`)

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lon, p.lat])
          .setPopup(popup)
          .addTo(map)

        parkingMarkersRef.current.push({ marker, el })
      })
    }

    if (map.isStyleLoaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [parking, viewMode])

  // Toggle parking markers visibility on viewMode change
  useEffect(() => {
    parkingMarkersRef.current.forEach(({ el }) => {
      el.style.visibility = viewMode === 'parking' ? 'visible' : 'hidden'
    })
  }, [viewMode])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minWidth: 0 }} />
}