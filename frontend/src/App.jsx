import { useEffect } from 'react'
import { useTransportStore } from './store/useTransportStore'
import { useTramData } from './hooks/useTramData'
import { useParkingData } from './hooks/useParkingData'
import TransportMap from './components/map/TransportMap'
import TramAnalytics from './components/tram/TramAnalytics'
import ParkingAnalytics from './components/parking/ParkingAnalytics'

const TABS = [
  { id: 'trams',   label: '🚊 Trams',   desc: 'Positions temps réel' },
  { id: 'parking', label: '🅿️ Parking',  desc: 'Disponibilité' },
]

export default function App() {
  const { activeTab, setActiveTab, showAnalytics, toggleAnalytics, tramPositions, parkingLive } = useTransportStore()

  // Activate data hooks (always running)
  useTramData()
  useParkingData()

  const showParking = activeTab === 'parking'

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-lg tracking-tight">
            🗺️ Grenoble Transport
          </span>
          <span className="hidden sm:block text-xs text-gray-500">Métropole</span>
        </div>

        {/* Tab switcher */}
        <nav className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Live status badge */}
        <div className="flex items-center gap-2">
          {activeTab === 'trams' && (
            <span className="text-xs text-gray-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1 animate-pulse" />
              {tramPositions.length} trams actifs
            </span>
          )}
          {activeTab === 'parking' && (
            <span className="text-xs text-gray-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-1 animate-pulse" />
              {parkingLive.length} parkings
            </span>
          )}
          <button
            onClick={toggleAnalytics}
            className="text-xs text-gray-500 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
          >
            {showAnalytics ? '← Masquer' : '→ Analyses'}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map — takes remaining space */}
        <div className="flex-1 relative">
          <TransportMap showParking={showParking} />
          {/* Map overlay legend */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-gray-900/90 backdrop-blur rounded-xl p-3 text-xs text-gray-300 space-y-1">
            {activeTab === 'trams' && (
              <>
                <p className="font-semibold text-gray-200 mb-1">Lignes TAG</p>
                {['A','B','C','D','E'].map(c => (
                  <div key={c} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{
                      background: { A:'#EE3333',B:'#0066CC',C:'#00AA44',D:'#FF8800',E:'#9933CC' }[c]
                    }} />
                    <span>Ligne {c}</span>
                  </div>
                ))}
                <p className="text-gray-500 mt-1">Cliquez une ligne pour filtrer</p>
              </>
            )}
            {activeTab === 'parking' && (
              <>
                <p className="font-semibold text-gray-200 mb-1">Occupation</p>
                {[['#22c55e','< 60%'],['#f97316','60–85%'],['#ef4444','> 85%']].map(([c,l]) => (
                  <div key={l} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: c }} />
                    <span>{l}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Analytics side panel */}
        {showAnalytics && (
          <aside className="w-80 xl:w-96 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden panel-slide">
            <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-200">
                {activeTab === 'trams' ? '📊 Analyses Trams' : '📊 Analyses Parking'}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'trams'   && <TramAnalytics />}
              {activeTab === 'parking' && <ParkingAnalytics />}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
