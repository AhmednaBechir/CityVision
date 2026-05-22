import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { fetchSchedule } from '../api'

export default function TramPanel() {
  const { tramLines, selectedLine, selectedStop, setSelectedLine } = useStore()
  const [schedule, setSchedule] = useState(null)

  useEffect(() => {
    if (!selectedLine) { setSchedule(null); return }
    const id = selectedLine.replace(':', '_')
    fetchSchedule(id).then(setSchedule).catch(console.error)
  }, [selectedLine])

  const stopSchedule = selectedStop && schedule
    ? Object.values(schedule).flatMap(dir =>
        (dir.arrets || []).filter(s => s.stopId === selectedStop.stopId)
      )[0]
    : null

  return (
    <div className="card">
      <h3>Tram Lines</h3>
      <div>
        {tramLines.map(line => (
          <span
            key={line.id}
            className="line-badge"
            style={{
              background: '#' + (line.color || '555'),
              color: '#' + (line.textColor || 'fff'),
              outline: selectedLine === line.id ? '2px solid white' : 'none',
            }}
            onClick={() => setSelectedLine(line.id)}
          >
            {line.shortName}
          </span>
        ))}
      </div>

      {selectedStop && (
        <div style={{ marginTop: 12, borderTop: '1px solid #2a2d3a', paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            📍 {selectedStop.stopName}
          </div>
          {stopSchedule?.upcoming?.length > 0 ? (
            stopSchedule.upcoming.map((u, i) => (
              <div key={i} style={{ fontSize: 12, padding: '3px 0', color: u.minutes_away < 2 ? '#4caf50' : '#ccc' }}>
                {u.minutes_away < 0 ? 'now' : `${u.minutes_away} min`}
                <span style={{ color: '#666', marginLeft: 8 }}>
                  {Math.floor(u.secs/3600).toString().padStart(2,'0')}:
                  {Math.floor((u.secs%3600)/60).toString().padStart(2,'0')}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: '#666' }}>No upcoming departures</div>
          )}
        </div>
      )}
    </div>
  )
}