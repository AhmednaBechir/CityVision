import { useEffect, useCallback } from 'react'
import { useTransportStore } from '../store/useTransportStore'
import {
  fetchTramLines,
  fetchTramStops,
  fetchTramPositions,
  fetchDelayProbability,
  fetchReliability,
  fetchPunctuality,
} from '../services/api'

const POSITION_POLL_MS = 10_000   // every 10s — matches Redis cache TTL
const ANALYTICS_POLL_MS = 60_000  // every 60s

export function useTramData() {
  const {
    setTramLines, setTramStops, setTramPositions,
    setDelayProbability, setReliability, setPunctuality,
    selectedLine,
  } = useTransportStore()

  // Load static data once
  useEffect(() => {
    fetchTramLines().then(setTramLines).catch(console.warn)
    fetchTramStops().then(setTramStops).catch(console.warn)
  }, [])

  // Poll positions
  useEffect(() => {
    const poll = () => fetchTramPositions().then(setTramPositions).catch(console.warn)
    poll()
    const id = setInterval(poll, POSITION_POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Poll analytics (slower)
  useEffect(() => {
    const poll = () => {
      fetchDelayProbability(selectedLine?.id).then(setDelayProbability).catch(console.warn)
      fetchReliability().then(setReliability).catch(console.warn)
      fetchPunctuality(selectedLine?.id).then(setPunctuality).catch(console.warn)
    }
    poll()
    const id = setInterval(poll, ANALYTICS_POLL_MS)
    return () => clearInterval(id)
  }, [selectedLine])
}
