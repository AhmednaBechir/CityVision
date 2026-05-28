import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

export const fetchTramLines = () => http.get('/trams/lines').then(r => r.data)
export const fetchSchedule = (lineId) => http.get(`/trams/schedule/${lineId}`).then(r => r.data)
export const fetchParkingLive = () => http.get('/parking/live').then(r => r.data)
export const fetchParkingHistory = (id, hours=24) => http.get(`/parking/history/${id}?hours=${hours}`).then(r => r.data)
export const fetchVoiLive = () => http.get('/voi/live').then(r => r.data)
export const fetchStoptimes = (clusterCode) => http.get(`/trams/stoptimes/${clusterCode}`).then(r => r.data)
export const fetchRealtimeTrams = (lineId) => http.get(`/trams/realtime/${lineId}`).then(r => r.data)
export const fetchDelayAnalytics = () => http.get('/trams/analytics/delays').then(r => r.data)
export const fetchLineDelays = (lineId, hours=24) => http.get(`/trams/analytics/delays/${lineId}?hours=${hours}`).then(r => r.data)
