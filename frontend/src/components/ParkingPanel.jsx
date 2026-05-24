import React, {
  useEffect,
  useState,
  useRef
} from 'react'

import { useStore } from '../store'
import { fetchParkingHistory } from '../api'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts'

export default function ParkingPanel() {
  const {
    parking,
    selectedParking,
    setSelectedParking
  } = useStore()

  const [history, setHistory] = useState([])

  const rowRefs = useRef({})

  const withSensor = parking
    .filter(p => p.has_sensor)
    .sort(
      (a, b) =>
        (a.free ?? 999) -
        (b.free ?? 999)
    )

  useEffect(() => {
    if (!selectedParking) {
      setHistory([])
      return
    }

    fetchParkingHistory(selectedParking.id)
      .then(setHistory)
      .catch(console.error)
  }, [selectedParking])

  // Scroll selected row into view
  useEffect(() => {
    if (
      selectedParking &&
      rowRefs.current[selectedParking.id]
    ) {
      rowRefs.current[
        selectedParking.id
      ].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [selectedParking])

  const freeClass = (p) => {
    if (!p.has_sensor)
      return 'free-none'

    const pct =
      p.total > 0
        ? p.free / p.total
        : 0

    return pct > 0.4
      ? 'free-high'
      : pct > 0.15
      ? 'free-med'
      : 'free-low'
  }

  const fmtTime = (str) => {
    if (!str) return ''

    const d = new Date(str)

    return `${d
      .getHours()
      .toString()
      .padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`
  }

  return (
    <div className="card">
      <h3>
        Parking ({withSensor.length} live)
      </h3>

      {withSensor.map(p => (
        <div
          key={p.id}
          ref={el =>
            (rowRefs.current[p.id] = el)
          }
          className="parking-row"
          style={{
            cursor: 'pointer',

            background:
              selectedParking?.id === p.id
                ? '#1a4a7a'
                : 'transparent',

            borderRadius: 6,

            padding: '6px 4px',

            border:
              selectedParking?.id === p.id
                ? '1px solid #3376b8'
                : '1px solid transparent',

            marginBottom: 2,
          }}
          onClick={() =>
            setSelectedParking(
              selectedParking?.id === p.id
                ? null
                : p
            )
          }
        >
          <span
            style={{
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {p.name}
          </span>

          <span
            className={`free-badge ${freeClass(
              p
            )}`}
          >
            {p.free} / {p.total}
          </span>
        </div>
      ))}

      {selectedParking && (
        <div
          style={{
            marginTop: 12,
            borderTop:
              '1px solid #2a2d3a',
            paddingTop: 10
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 4
            }}
          >
            {selectedParking.name}
          </div>

          <div
            style={{
              fontSize: 12,
              color: '#888',
              marginBottom: 8
            }}
          >
            {selectedParking.free} free /{' '}
            {selectedParking.total} total
          </div>

          {history.length > 1 ? (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: '#8888aa',
                  marginBottom: 4
                }}
              >
                OCCUPANCY (24h)
              </div>

              <ResponsiveContainer
                width="100%"
                height={120}
              >
                <LineChart data={history}>
                  <XAxis
                    dataKey="time"
                    tickFormatter={fmtTime}
                    tick={{
                      fontSize: 9
                    }}
                    interval="preserveStartEnd"
                  />

                  <YAxis
                    tick={{
                      fontSize: 9
                    }}
                  />

                  <Tooltip
                    formatter={v => [
                      `${v} free`,
                      ''
                    ]}
                    labelFormatter={fmtTime}
                    contentStyle={{
                      background:
                        '#1a1d27',
                      border: 'none',
                      fontSize: 11
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="free"
                    stroke="#3376b8"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: '#666'
              }}
            >
              No history yet — check back
              in 10 min
            </div>
          )}
        </div>
      )}
    </div>
  )
}