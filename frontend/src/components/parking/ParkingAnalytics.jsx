import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { useTransportStore } from '../../store/useTransportStore'
import { fetchParkingOccupancy, fetchParkingTrend } from '../../services/api'

export default function ParkingAnalytics() {
  const {
    parkingLive, parkingZones, congestion,
    selectedParking, setSelectedParking,
  } = useTransportStore()

  const [occupancy, setOccupancy] = useState([])
  const [trend, setTrend] = useState(null)

  // Load occupancy history when a parking is selected
  useEffect(() => {
    if (!selectedParking) return
    fetchParkingOccupancy(selectedParking.id, 24)
      .then(setOccupancy)
      .catch(console.warn)
    fetchParkingTrend(selectedParking.id, 48)
      .then(setTrend)
      .catch(console.warn)
  }, [selectedParking?.id])

  const congestionColor = (pct) =>
    pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#22c55e'

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">

      {/* Zone summary cards */}
      <div>
        <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Disponibilité par zone</p>
        <div className="grid grid-cols-2 gap-2">
          {parkingZones.map(z => (
            <div key={z.zone} className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-300 truncate">{z.zone}</p>
              <p className="text-lg font-bold" style={{ color: congestionColor(z.avg_occupancy_pct) }}>
                {z.total_available ?? '—'}
              </p>
              <p className="text-xs text-gray-500">places libres</p>
              <div className="mt-1.5 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${z.avg_occupancy_pct ?? 0}%`,
                    background: congestionColor(z.avg_occupancy_pct),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Congestion heatmap */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-200">Zones de congestion</h3>
        {congestion.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={congestion} layout="vertical" barSize={14}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis type="category" dataKey="zone" tick={{ fill: '#9ca3af', fontSize: 11 }} width={70} />
              <Tooltip
                formatter={v => [`${v}%`, 'Occupation moy.']}
                contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8 }}
              />
              <Bar
                dataKey="avg_pct"
                radius={[0, 4, 4, 0]}
                fill="#f97316"
                label={{ position: 'right', formatter: v => `${v}%`, fill: '#9ca3af', fontSize: 10 }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Live parking list */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-200">Parkings en temps réel</h3>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {parkingLive.map(p => (
            <button
              key={p.id}
              className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                selectedParking?.id === p.id ? 'bg-blue-900/40 border border-blue-500' : 'hover:bg-gray-700/50'
              }`}
              onClick={() => setSelectedParking(selectedParking?.id === p.id ? null : p)}
            >
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: congestionColor(p.occupancy_pct) }}
              />
              <span className="text-xs text-gray-300 flex-1 truncate">{p.name}</span>
              <span className="text-xs font-mono text-gray-400">{p.available ?? '?'}p</span>
            </button>
          ))}
        </div>
      </div>

      {/* Selected parking occupancy */}
      {selectedParking && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-1 text-gray-200">{selectedParking.name}</h3>
          <p className="text-xs text-gray-500 mb-3">Occupation sur 24h</p>
          {occupancy.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={occupancy.map(r => ({
                h: new Date(r.hour_bucket).getUTCHours() + 'h',
                pct: r.avg_occupancy_pct,
              }))}>
                <defs>
                  <linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="h" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8 }}
                  formatter={v => [`${v}%`, 'Occupation']}
                />
                <Area type="monotone" dataKey="pct" stroke="#f97316" fill="url(#occGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* Trend forecast */}
          {trend && trend.trend !== 'insufficient_data' && (
            <div className="mt-3 border-t border-gray-700 pt-3">
              <p className="text-xs text-gray-400 mb-2">Prévision tendance</p>
              <div className="flex gap-2">
                {trend.forecast.map(f => (
                  <div key={f.hours_ahead} className="flex-1 bg-gray-700 rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">+{f.hours_ahead}h</p>
                    <p className="text-sm font-bold"
                      style={{ color: congestionColor(f.predicted_occupancy_pct) }}>
                      {f.predicted_occupancy_pct}%
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Tendance: <span className={
                  trend.trend === 'increasing' ? 'text-red-400' :
                  trend.trend === 'decreasing' ? 'text-green-400' : 'text-yellow-400'
                }>{trend.trend === 'increasing' ? '↑ hausse' : trend.trend === 'decreasing' ? '↓ baisse' : '→ stable'}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-6 text-gray-500 text-sm">
      <p>Données insuffisantes</p>
      <p className="text-xs mt-1 text-gray-600">Collecte en cours…</p>
    </div>
  )
}
