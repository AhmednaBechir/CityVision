import React, { useMemo } from 'react'
import { useStore } from '../store'

export default function ParkingPanel() {
  const { parking } = useStore()

  const withSensor = useMemo(() =>
    parking.filter(p => p.has_sensor).sort((a, b) => (a.free ?? 0) - (b.free ?? 0))
  , [parking])

  const freeClass = (p) => {
    if (!p.has_sensor) return 'free-none'
    const pct = p.total > 0 ? p.free / p.total : 0
    return pct > 0.4 ? 'free-high' : pct > 0.15 ? 'free-med' : 'free-low'
  }

  return (
    <div className="card">
      <h3>Parking ({withSensor.length} live)</h3>
      {withSensor.slice(0, 10).map(p => (
        <div key={p.id} className="parking-row">
          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name}
          </span>
          <span className={`free-badge ${freeClass(p)}`}>
            {p.free} / {p.total}
          </span>
        </div>
      ))}
      {!withSensor.length && <p style={{ color: '#666', fontSize: 12 }}>Loading...</p>}
    </div>
  )
}