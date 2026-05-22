import React, { useEffect } from 'react'
import { fetchTramLines, fetchParkingLive } from './api'
import { useStore } from './store'
import MapView from './components/MapView'
import TramPanel from './components/TramPanel'
import ParkingPanel from './components/ParkingPanel'

export default function App() {
  const { setTramLines, setParking } = useStore()

  useEffect(() => {
    fetchTramLines().then(setTramLines).catch(console.error)
    const loadParking = () => fetchParkingLive().then(setParking).catch(console.error)
    loadParking()
    const t = setInterval(loadParking, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div className="sidebar">
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', paddingBottom: 8, borderBottom: '1px solid #2a2d3a' }}>
          🚋 Grenoble Transport
        </div>
        <TramPanel />
        <ParkingPanel />
      </div>
      <div className="map-container" style={{ flex: 1, height: '100vh' }}>
        <MapView />
      </div>
    </div>
  )
}