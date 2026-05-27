import React, {
  useEffect,
  useState
} from 'react'

import { useStore } from '../store'
import { fetchSchedule } from '../api'
import axios from 'axios'

export default function VoiPanel() {
  const { selectedVoi, voiStats } = useStore()

  useEffect(() => {
    console.log('selectedVoi updated:', selectedVoi)
  }, [selectedVoi])


    return (
      <div>
        <div style={{ padding: 12 }}>
          <p>
            Total VOI: {voiStats ? voiStats.total : 'Loading...'}<br />
            Nombre de Velo: {voiStats ? voiStats.types.voi_bike : 'Loading...'}<br />
            Nombre de Scooter: {voiStats ? voiStats.types.voi_scooter : 'Loading...'}<br />
          </p>
        </div>
        {selectedVoi &&
        <div style={{ padding: 12 }}>
          <h3>VOI Stats</h3>
          
          <p style={{ color: selectedVoi.reserved ? 'red' : 'green' }}>
            {selectedVoi.reserved ? 'Reserved' : 'Available'}
          </p>
          <p style={{ color: selectedVoi.disabled ? 'red' : 'green' }}>
            {selectedVoi.disabled ? 'Disabled' : 'Working'}
          </p>
          <p>{selectedVoi.range_meters} Km</p>
        </div>
    }
      </div>
    )
}
