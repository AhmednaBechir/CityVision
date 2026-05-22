import React from 'react'
import { useStore } from '../store'
import { fetchSchedule } from '../api'

export default function TramPanel() {
  const { tramLines, selectedLine, setSelectedLine } = useStore()

  const handleSelect = async (line) => {
    setSelectedLine(line.id === selectedLine ? null : line.id)
  }

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
            onClick={() => handleSelect(line)}
          >
            {line.shortName}
          </span>
        ))}
      </div>
      {!tramLines.length && <p style={{ color: '#666', fontSize: 12 }}>Loading lines...</p>}
    </div>
  )
}