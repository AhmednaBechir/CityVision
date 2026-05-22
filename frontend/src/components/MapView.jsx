import React, { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useStore } from '../store'

const TRAM_COLORS = {
  A: '#e30613', B: '#0070c0', C: '#00a651',
  D: '#f7941d', E: '#92278f'
}

export default function MapView() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const { tramLines, parking, selectedLine } = useStore()

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

        if (map.getSource(id)) {
          map.getSource(id).setData(line.geometry)
        } else {
          map.addSource(id, { type: 'geojson', data: line.geometry })
          map.addLayer({
            id,
            type: 'line',
            source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': color,
              'line-width': selectedLine === line.id ? 5 : 3,
              'line-opacity': 0.9,
            }
          })
        }
      })
    }

    if (map.isStyleLoaded()) draw()
    else map.on('load', draw)
  }, [tramLines, selectedLine])

  // Draw parking markers
  useEffect(() => {
    const map = mapInstance.current
    if (!map || !parking.length) return

    const addMarkers = () => {
      parking.filter(p => p.lat && p.lon).forEach(p => {
        const pct = p.total > 0 ? (p.free / p.total) : null
        const color = pct === null ? '#555' : pct > 0.4 ? '#4caf50' : pct > 0.15 ? '#ff9800' : '#f44336'

        const el = document.createElement('div')
        el.style.cssText = `
          width:10px;height:10px;border-radius:50%;
          background:${color};border:2px solid #fff;cursor:pointer;
        `
        const popup = new maplibregl.Popup({ offset: 12 }).setHTML(`
          <div style="font-size:12px;color:#000">
            <b>${p.name}</b><br/>
            ${p.has_sensor ? `Free: ${p.free} / ${p.total}` : 'No sensor data'}
          </div>
        `)
        new maplibregl.Marker({ element: el })
          .setLngLat([p.lon, p.lat])
          .setPopup(popup)
          .addTo(map)
      })
    }

    if (map.isStyleLoaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [parking])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minWidth: 0 }} />
}