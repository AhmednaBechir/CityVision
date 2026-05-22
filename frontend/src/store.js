import { create } from 'zustand'

export const useStore = create((set) => ({
  tramLines: [],
  selectedLine: null,
  selectedStop: null,
  parking: [],
  viewMode: 'trams', // 'trams' | 'parking'
  setTramLines: (lines) => set({ tramLines: lines }),
  setSelectedLine: (line) => set({ selectedLine: line, selectedStop: null }),
  setSelectedStop: (stop) => set({ selectedStop: stop }),
  setParking: (p) => set({ parking: p }),
  setViewMode: (mode) => set({ viewMode: mode }),
}))