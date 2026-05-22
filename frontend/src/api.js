import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

export const fetchTramLines = () => http.get('/trams/lines').then(r => r.data)
export const fetchSchedule = (lineId) => http.get(`/trams/schedule/${lineId}`).then(r => r.data)
export const fetchParkingLive = () => http.get('/parking/live').then(r => r.data)