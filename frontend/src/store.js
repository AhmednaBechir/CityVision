import { create } from 'zustand'

export const useStore = create((set) => ({
  tramLines: [],
  selectedLine: null,
  parking: [],
  setTramLines: (lines) => set({ tramLines: lines }),
  setSelectedLine: (line) => set({ selectedLine: line }),
  setParking: (p) => set({ parking: p }),
}))