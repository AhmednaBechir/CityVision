import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export const useStore = create(subscribeWithSelector((set) => ({
  tramLines: [],
  selectedLine: null,
  selectedStop: null,
  selectedParking: null,
  parking: [],
  voi: [],
  viewMode: 'trams',
  setTramLines: (lines) => set({ tramLines: lines }),
  setSelectedLine: (line) => set({ selectedLine: line, selectedStop: null }),
  setSelectedStop: (stop) => set({ selectedStop: stop }),
  setSelectedParking: (p) => set({ selectedParking: p }),
  setParking: (p) => set({ parking: p }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setVoi: (voi) => set({ voi }),
})))