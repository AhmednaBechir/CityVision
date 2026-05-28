import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export const useStore = create(subscribeWithSelector((set) => ({
  tramLines: [],
  selectedLine: null,
  selectedStop: null,
  selectedParking: null,
  parking: [],
  voi: [],
  selectedVoi: null,
  voiStats: null,
  voiTypeSelected: 'All',
  viewMode: 'trams',
  setTramLines: (lines) => set({ tramLines: lines }),
  setSelectedLine: (line) => set({ selectedLine: line, selectedStop: null }),
  setSelectedStop: (stop) => set({ selectedStop: stop }),
  setSelectedParking: (p) => set({ selectedParking: p }),
  setParking: (p) => set({ parking: p }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setVoi: (voi) => set({ voi }),
  setSelectedVoi: (v) => set({ selectedVoi: v }),
  setVoiStats: (stats) => set({ voiStats: stats }),
  setVoiTypeSelected: (categorie) => set({ voiTypeSelected: categorie}),
})))