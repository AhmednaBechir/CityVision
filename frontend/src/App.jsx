import React, { useEffect } from 'react'
import { fetchTramLines, fetchParkingLive, fetchVoiLive, fetchVoiStats } from './api'
import { useStore } from './store'
import MapView from './components/MapView'
import TramPanel from './components/TramPanel'
import ParkingPanel from './components/ParkingPanel'
import VoiPanel from './components/VoiPanel'

export default function App() {
  const { setTramLines, setParking, setSelectedLine, viewMode, setViewMode, setVoi, setVoiStats } = useStore()

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
    const loadVoi = () => fetchVoiLive().then(setVoi).catch(console.error)
    loadVoi()
    const t2 = setInterval(loadVoi, 60000)
    const loadVoiStats = () => fetchVoiStats().then(setVoiStats).catch(console.error)
    loadVoiStats()
    const t3 = setInterval(loadVoiStats, 60000)
    return () => {clearInterval(t)
      clearInterval(t2)
      clearInterval(t3)
    }
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
          <button
            onClick={() => setViewMode('voi')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: viewMode === 'voi' ? '#3376b8' : '#2a2d3a',
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            🛴 VOI
          </button>
        </div>
        {viewMode === 'trams' ? (
          <TramPanel />
        ) : viewMode === 'parking' ? (
          <ParkingPanel />
        ) : viewMode === 'voi' ? (
          <VoiPanel />
        ) : null}
      </div>
      <div className="map-container">
        <MapView />
      </div>
    </div>
  )
}