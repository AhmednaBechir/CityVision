import { create } from 'zustand'

export const useTransportStore = create((set, get) => ({
  // ── Active tab ─────────────────────────────────────────────────
  activeTab: 'trams',    // 'trams' | 'parking'
  setActiveTab: (tab) => set({ activeTab: tab }),

  // ── Tram data ──────────────────────────────────────────────────
  tramLines: [],
  tramStops: [],
  tramPositions: [],
  selectedLine: null,
  delayProbability: [],
  reliability: [],
  punctuality: [],

  setTramLines: (lines) => set({ tramLines: lines }),
  setTramStops: (stops) => set({ tramStops: stops }),
  setTramPositions: (pos) => set({ tramPositions: pos }),
  setSelectedLine: (line) => set({ selectedLine: line }),
  setDelayProbability: (data) => set({ delayProbability: data }),
  setReliability: (data) => set({ reliability: data }),
  setPunctuality: (data) => set({ punctuality: data }),

  // ── Parking data ───────────────────────────────────────────────
  parkingLive: [],
  parkingZones: [],
  parkingOccupancy: [],
  congestion: [],
  selectedParking: null,

  setParkingLive: (data) => set({ parkingLive: data }),
  setParkingZones: (data) => set({ parkingZones: data }),
  setParkingOccupancy: (data) => set({ parkingOccupancy: data }),
  setCongestion: (data) => set({ congestion: data }),
  setSelectedParking: (p) => set({ selectedParking: p }),

  // ── UI state ───────────────────────────────────────────────────
  showAnalytics: true,
  toggleAnalytics: () => set(s => ({ showAnalytics: !s.showAnalytics })),
}))
