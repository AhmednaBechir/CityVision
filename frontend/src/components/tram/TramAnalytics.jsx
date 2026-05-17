import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { useTransportStore } from '../../store/useTransportStore'

const TRAM_COLORS = { A: '#EE3333', B: '#0066CC', C: '#00AA44', D: '#FF8800', E: '#9933CC' }

function getLineColor(lineId = '') {
  const code = lineId.replace('SEM_', '')
  return TRAM_COLORS[code] || '#888'
}

export default function TramAnalytics() {
  const { delayProbability, reliability, punctuality, tramLines, selectedLine, setSelectedLine } = useTransportStore()

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">

      {/* Line selector */}
      <div>
        <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Lignes</p>
        <div className="flex gap-2 flex-wrap">
          {tramLines.map(line => (
            <button
              key={line.id}
              onClick={() => setSelectedLine(selectedLine?.id === line.id ? null : line)}
              className="px-3 py-1 rounded-full text-sm font-bold transition-all"
              style={{
                background: selectedLine?.id === line.id ? (line.color || '#888') : 'transparent',
                color: selectedLine?.id === line.id ? '#fff' : (line.color || '#ccc'),
                border: `2px solid ${line.color || '#888'}`,
              }}
            >
              {line.code}
            </button>
          ))}
        </div>
      </div>

      {/* Delay probability */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-200">
          Probabilité de retard par ligne
        </h3>
        {delayProbability.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={delayProbability} barSize={24}>
              <XAxis dataKey="line_id" tickFormatter={v => v.replace('SEM_', '')} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                formatter={(v) => [`${v}%`, 'Retard']}
                contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8 }}
              />
              <Bar
                dataKey="delay_probability"
                fill="#ef4444"
                radius={[4, 4, 0, 0]}
                label={{ position: 'top', formatter: v => `${v}%`, fill: '#9ca3af', fontSize: 10 }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Reliability score */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-200">
          Score de fiabilité par arrêt (Top 15)
        </h3>
        {reliability.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {reliability.slice(0, 15).map(r => (
              <div key={r.stop_id} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-24 truncate" title={r.stop_name}>
                  {r.stop_name || r.stop_id}
                </span>
                <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${r.reliability_score}%`,
                      background: r.reliability_score >= 80 ? '#22c55e'
                        : r.reliability_score >= 60 ? '#f97316' : '#ef4444',
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-300 w-8 text-right">
                  {r.reliability_score}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical punctuality */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-200">
          Ponctualité historique (24h)
        </h3>
        {punctuality.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={formatPunctuality(punctuality)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hour" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8 }}
                formatter={(v, name) => [`${v}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {getUniqueLines(punctuality).map(lineId => (
                <Line
                  key={lineId}
                  type="monotone"
                  dataKey={lineId}
                  stroke={getLineColor(lineId)}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-6 text-gray-500 text-sm">
      <p>Collecte des données en cours…</p>
      <p className="text-xs mt-1 text-gray-600">Les statistiques apparaîtront après quelques minutes de collecte.</p>
    </div>
  )
}

// Pivot punctuality rows into { hour, 'SEM_A': pct, 'SEM_B': pct, ... }
function formatPunctuality(rows) {
  const byHour = {}
  for (const row of rows) {
    const h = new Date(row.hour_bucket).getHours() + 'h'
    if (!byHour[h]) byHour[h] = { hour: h }
    byHour[h][row.line_id] = row.on_time_pct
  }
  return Object.values(byHour)
}

function getUniqueLines(rows) {
  return [...new Set(rows.map(r => r.line_id))]
}
