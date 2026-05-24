import React, {
  useEffect,
  useState
} from 'react'

import { useStore } from '../store'
import { fetchSchedule } from '../api'
import axios from 'axios'

export default function TramPanel() {
  const {
    tramLines,
    selectedLine,
    selectedStop,
    setSelectedLine
  } = useStore()

  // Debug selected stop
  useEffect(() => {
    console.log(
      'selectedStop:',
      selectedStop?.stopName
    )
  }, [selectedStop])

  const [schedule, setSchedule] =
    useState(null)

  const [dayStats, setDayStats] =
    useState(null)

  useEffect(() => {
    if (!selectedLine) {
      setSchedule(null)
      setDayStats(null)
      return
    }

    const id = selectedLine.replace(':', '_')

    const loadSchedule = () =>
      fetchSchedule(id).then(setSchedule).catch(console.error)

    loadSchedule()
    const t = setInterval(loadSchedule, 30000)

    axios.get(`/api/trams/stopstats/${id}`)
      .then(r => setDayStats(r.data))
      .catch(console.error)

    return () => clearInterval(t)
  }, [selectedLine])

  const stopSchedule =
    selectedStop && schedule
      ? Object.values(schedule)
          .flatMap(
            dir => dir.arrets || []
          )
          .filter(
            s =>
              s.stopId ===
              selectedStop.stopId
          )[0]
      : null

  {/*console.log(
    'stopSchedule:',
    stopSchedule,
    'stopId:',
    selectedStop?.stopId
  )

  console.log('upcoming:', stopSchedule?.upcoming, 'length:', stopSchedule?.upcoming?.length)
  */}
  // Match by stop name
  const stopStats =
    selectedStop && dayStats
      ? dayStats[
          selectedStop.stopName
        ]
      : null

  const fmt = secs =>
    `${Math.floor(secs / 3600)
      .toString()
      .padStart(
        2,
        '0'
      )}:${Math.floor(
      (secs % 3600) / 60
    )
      .toString()
      .padStart(2, '0')}`

  return (
    <div className="card">
      <h3>Tram Lines</h3>

      <div>
        {tramLines.map(line => (
          <span
            key={line.id}
            className="line-badge"
            style={{
              background:
                '#' +
                (line.color || '555'),
              color:
                '#' +
                (line.textColor ||
                  'fff'),
              outline:
                selectedLine ===
                line.id
                  ? '2px solid white'
                  : 'none'
            }}
            onClick={() =>
              setSelectedLine(line.id)
            }
          >
            {line.shortName}
          </span>
        ))}
      </div>

      {selectedStop && (
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
              marginBottom: 8
            }}
          >
            📍 {selectedStop.stopName}
          </div>

          {/* Next departures */}
          <div
            style={{
              fontSize: 11,
              color: '#8888aa',
              marginBottom: 4
            }}
          >
            NEXT DEPARTURES
          </div>

          {stopSchedule?.upcoming
            ?.length > 0 ? (
            stopSchedule.upcoming.map(
              (u, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    padding:
                      '3px 0',
                    display: 'flex',
                    justifyContent:
                      'space-between'
                  }}
                >
                  <span
                    style={{
                      color:
                        u.minutes_away <
                        2
                          ? '#4caf50'
                          : '#ccc'
                    }}
                  >
                    {u.minutes_away <=
                    0
                      ? '🚋 now'
                      : `${u.minutes_away} min`}
                  </span>

                  <span
                    style={{
                      color: '#666'
                    }}
                  >
                    {fmt(u.secs)}
                  </span>
                </div>
              )
            )
          ) : (
            <div
              style={{
                fontSize: 12,
                color: '#666'
              }}
            >
              No upcoming departures
            </div>
          )}

          {/* Day stats */}
          {stopStats && (
            <div
              style={{
                marginTop: 10,
                borderTop:
                  '1px solid #2a2d3a',
                paddingTop: 8
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#8888aa',
                  marginBottom: 6
                }}
              >
                TODAY'S SERVICE
              </div>

              {Object.entries(
                stopStats.dirs || {}
              ).map(([dir, s]) => (
                <div
                  key={dir}
                  style={{
                    marginBottom: 8
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#aaa',
                      marginBottom: 4
                    }}
                  >
                    →{' '}
                    {s.terminus ||
                      `Direction ${dir}`}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        '1fr 1fr',
                      gap: '4px 0',
                      fontSize: 12
                    }}
                  >
                    <span
                      style={{
                        color: '#888'
                      }}
                    >
                      First
                    </span>

                    <span
                      style={{
                        textAlign:
                          'right'
                      }}
                    >
                      {fmt(s.first)}
                    </span>

                    <span
                      style={{
                        color: '#888'
                      }}
                    >
                      Last
                    </span>

                    <span
                      style={{
                        textAlign:
                          'right'
                      }}
                    >
                      {fmt(s.last)}
                    </span>

                    <span
                      style={{
                        color: '#888'
                      }}
                    >
                      Frequency
                    </span>

                    <span
                      style={{
                        textAlign:
                          'right'
                      }}
                    >
                      every{' '}
                      {s.avg_gap_min}{' '}
                      min
                    </span>

                    <span
                      style={{
                        color: '#888'
                      }}
                    >
                      Daily trips
                    </span>

                    <span
                      style={{
                        textAlign:
                          'right'
                      }}
                    >
                      {s.total_trips}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}