import React, {
  useEffect,
  useState
} from 'react'

import { useStore } from '../store'
import { fetchSchedule } from '../api'
import axios from 'axios'

export default function VoiPanel() {
  const { selectedVoi, voiStats, setVoiTypeSelected } = useStore()

  useEffect(() => {
    console.log('selectedVoi updated:', selectedVoi)
  }, [selectedVoi])

  const categories = ['All', 'Bikes', 'Scooters']


    return (
      <div>
        <div className="card">
          <h3>Filter</h3>

          <div>
            {categories.map(categorie => (
              <span
                key={categorie}
                className="line-badge"
                onClick={() => {
                  setVoiTypeSelected(categorie)
                  console.log(categorie)
                }
                }
              >
                {categorie}
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>General VOI Stats</h3>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 8
            }}
          >
            Total VOI: {voiStats ? voiStats.total : 'Loading...'}<br />
            Total bikes: {voiStats ? voiStats.types.voi_bike : 'Loading...'}<br />
            Total scooters: {voiStats ? voiStats.types.voi_scooter : 'Loading...'}<br />
          </div>
        </div>
        {selectedVoi &&
        <div className="card">
          <h3>VOI Stats</h3>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 8
            }}
          >
          <p style={{ color: selectedVoi.reserved ? 'red' : 'green' }}>
            {selectedVoi.reserved ? 'Reserved' : 'Available'}
          </p>
          <p style={{ color: selectedVoi.disabled ? 'red' : 'green' }}>
            {selectedVoi.disabled ? 'Disabled' : 'Working'}
          </p>
          <p>{selectedVoi.range_meters} Km</p>
          </div>
        </div>
    }
      </div>
    )
}
