import React, {
  useEffect,
  useState
} from 'react'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts'

import { useStore } from '../store'
import axios from 'axios'

import {
  fetchSchedule,
  fetchStoptimes,
  fetchDelayAnalytics,
  fetchLineDelays
} from '../api'

export default function TramPanel() {
  const {
    tramLines,
    selectedLine,
    selectedStop,
    setSelectedLine
  } = useStore()

  const [schedule, setSchedule] =
    useState(null)

  const [dayStats, setDayStats] =
    useState(null)

  const [delays, setDelays] =
    useState([])

  const [lineDelays, setLineDelays] =
    useState([])

  const [lineHistory, setLineHistory] =
    useState([])

  // Debug selected stop
  useEffect(() => {
    console.log(
      'selectedStop:',
      selectedStop?.stopName
    )
  }, [selectedStop])

  // Load line analytics
  useEffect(() => {
    fetchDelayAnalytics()
      .then(setLineDelays)
      .catch(console.error)
  }, [])

  // Load line-specific delay history
  useEffect(() => {
    if (!selectedLine) {
      setLineHistory([])
      return
    }

    const id =
      selectedLine.replace(':', '_')

    fetchLineDelays(id)
      .then(setLineHistory)
      .catch(console.error)
  }, [selectedLine])

  // Fetch real-time delays
  useEffect(() => {
    if (
      !selectedStop?.parentStation
        ?.code
    ) {
      setDelays([])
      return
    }

    fetchStoptimes(
      selectedStop.parentStation.code
    )
      .then(setDelays)
      .catch(console.error)
  }, [selectedStop])

  useEffect(() => {
    if (!selectedLine) {
      setSchedule(null)
      setDayStats(null)
      return
    }

    const id =
      selectedLine.replace(':', '_')

    const loadSchedule = () =>
      fetchSchedule(id)
        .then(setSchedule)
        .catch(console.error)

    loadSchedule()

    const t = setInterval(
      loadSchedule,
      30000
    )

    axios
      .get(
        `/api/trams/stopstats/${id}`
      )
      .then(r =>
        setDayStats(r.data)
      )
      .catch(console.error)

    return () => clearInterval(t)
  }, [selectedLine])

  // Find stop schedules for BOTH directions
  const stopSchedules =
    selectedStop && schedule
      ? Object.entries(schedule)
          .map(([dir, d]) => {
            const match = (
              d.arrets || []
            ).find(
              s =>
                s.stopName ===
                selectedStop.stopName
            )

            if (!match) return null

            const terminus =
              d.arrets?.[
                d.arrets.length - 1
              ]?.stopName

            return {
              dir,
              terminus,
              upcoming:
                match.upcoming || []
            }
          })
          .filter(Boolean)
      : []

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

      {/* Line delay overview */}
      {lineDelays.length > 0 && (
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
            LINE PERFORMANCE (24h)
          </div>

          {lineDelays.map(d => {
            const shortName =
              d.line_id.replace(
                'SEM_',
                ''
              )

            const line =
              tramLines.find(
                l =>
                  l.shortName ===
                  shortName
              )

            const color = line
              ? '#' + line.color
              : '#555'

            const delayColor =
              d.avg_delay_sec > 60
                ? '#f44336'
                : d.avg_delay_sec > 30
                ? '#ff9800'
                : '#4caf50'

            return (
              <div
                key={d.line_id}
                style={{
                  display: 'flex',
                  alignItems:
                    'center',
                  gap: 6,
                  marginBottom: 5
                }}
              >
                <span
                  style={{
                    background:
                      color,
                    color: '#fff',
                    borderRadius: 10,
                    padding:
                      '2px 7px',
                    fontSize: 11,
                    fontWeight: 700,
                    minWidth: 20,
                    textAlign:
                      'center'
                  }}
                >
                  {shortName}
                </span>

                <span
                  style={{
                    fontSize: 12,
                    color:
                      delayColor,
                    minWidth: 50
                  }}
                >
                  +
                  {Math.round(
                    d.avg_delay_sec
                  )}
                  s
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: '#666'
                  }}
                >
                  {d.late_pct}% late
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: '#444',
                    marginLeft:
                      'auto'
                  }}
                >
                  {d.samples} trips
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Line delay history chart */}
      {selectedLine &&
        lineHistory.length > 1 && (
          <div
            style={{
              marginTop: 8
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#8888aa',
                marginBottom: 4
              }}
            >
              DELAY TREND —{' '}
              {selectedLine.replace(
                'SEM:',
                'Line '
              )}
            </div>

            <ResponsiveContainer
              width="100%"
              height={80}
            >
              <LineChart
                data={lineHistory}
              >
                <XAxis
                  dataKey="time"
                  tickFormatter={t =>
                    new Date(
                      t
                    ).getHours() + 'h'
                  }
                  tick={{
                    fontSize: 9
                  }}
                  interval="preserveStartEnd"
                />

                <YAxis
                  tick={{
                    fontSize: 9
                  }}
                  unit="s"
                />

                <Tooltip
                  formatter={v => [
                    `${v}s delay`,
                    ''
                  ]}
                  labelFormatter={t =>
                    new Date(
                      t
                    ).toLocaleTimeString()
                  }
                  contentStyle={{
                    background:
                      '#1a1d27',
                    border: 'none',
                    fontSize: 11
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="avg_delay"
                  stroke="#ff9800"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

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

          {stopSchedules.length >
          0 ? (
            stopSchedules.map(
              ({
                dir,
                terminus,
                upcoming
              }) => (
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
                      marginBottom: 3
                    }}
                  >
                    → {terminus}
                  </div>

                  {upcoming.length >
                  0 ? (
                    upcoming.map(
                      (u, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 12,
                            padding:
                              '2px 0',
                            display:
                              'flex',
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
                              color:
                                '#666'
                            }}
                          >
                            {fmt(
                              u.secs
                            )}
                          </span>
                        </div>
                      )
                    )
                  ) : (
                    <div
                      style={{
                        fontSize: 12,
                        color:
                          '#666'
                      }}
                    >
                      No upcoming
                    </div>
                  )}
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
              No upcoming
              departures
            </div>
          )}

          {/* Real-time delays */}
          {delays.length > 0 && (
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
                REAL-TIME DELAYS
              </div>

              {delays
                .slice(0, 5)
                .map((d, i) => {
                  const sec =
                    d.delay_sec

                  const color = sec > 60 ? '#f44336' : sec < -30 ? '#2196f3' : sec === 0 ? '#4caf50' : '#ff9800'
                  const label = sec === 0 ? 'on time' : sec > 0 ? `+${Math.round(sec/60)}min` : `${Math.round(sec/60)}min`

                  return (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        padding:
                          '3px 0',
                        display:
                          'flex',
                        justifyContent:
                          'space-between'
                      }}
                    >
                      <span
                        style={{
                          color:
                            '#aaa',
                          maxWidth: 160,
                          overflow:
                            'hidden',
                          textOverflow:
                            'ellipsis',
                          whiteSpace:
                            'nowrap'
                        }}
                      >
                        {d.pattern}
                      </span>

                      <span
                        style={{
                          color,
                          fontWeight: 600
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  )
                })}
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