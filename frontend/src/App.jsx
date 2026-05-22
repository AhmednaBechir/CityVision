import React, { useEffect } from 'react'
import { fetchTramLines, fetchParkingLive } from './api'
import { useStore } from './store'
import MapView from './components/MapView'
import TramPanel from './components/TramPanel'
import ParkingPanel from './components/ParkingPanel'

export default function App() {
  const { setTramLines, setParking, setSelectedLine, viewMode, setViewMode } = useStore()

  useEffect(() => {
    const loadLines = () => fetchTramLines()
      .then(lines => {
        setTramLines(lines)
        if (lines.length) setSelectedLine(lines[0].id)
      })
      .catch(() => setTimeout(loadLines, 2000))
    loadLines()
    const loadParking = () => fetchParkingLive().then(setParking).catch(console.error)
    loadParking()
    const t = setInterval(loadParking, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="app-wrapper">
      <div className="sidebar">
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', paddingBottom: 8, borderBottom: '1px solid #2a2d3a' }}>
          🚋 Grenoble Transport
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setViewMode('trams')}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: viewMode === 'trams' ? '#3376b8' : '#2a2d3a',
              color: '#fff', fontWeight: 600, fontSize: 13,
            }}
          >
            🚋 Trams
          </button>
          <button
            onClick={() => setViewMode('parking')}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: viewMode === 'parking' ? '#3376b8' : '#2a2d3a',
              color: '#fff', fontWeight: 600, fontSize: 13,
            }}
          >
            🅿️ Parking
          </button>
        </div>
        {viewMode === 'trams' ? <TramPanel /> : <ParkingPanel />}
      </div>
      <div className="map-container">
        <MapView />
      </div>
    </div>
  )
}