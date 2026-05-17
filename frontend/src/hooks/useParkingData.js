import { useEffect } from 'react'
import { useTransportStore } from '../store/useTransportStore'
import {
  fetchParkingLive,
  fetchParkingZones,
  fetchCongestion,
} from '../services/api'

const LIVE_POLL_MS   = 30_000
const STATIC_POLL_MS = 120_000

export function useParkingData() {
  const {
    setParkingLive, setParkingZones, setCongestion,
  } = useTransportStore()

  useEffect(() => {
    const pollLive = () => fetchParkingLive().then(setParkingLive).catch(console.warn)
    pollLive()
    const id = setInterval(pollLive, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const pollStatic = () => {
      fetchParkingZones().then(setParkingZones).catch(console.warn)
      fetchCongestion().then(setCongestion).catch(console.warn)
    }
    pollStatic()
    const id = setInterval(pollStatic, STATIC_POLL_MS)
    return () => clearInterval(id)
  }, [])
}
