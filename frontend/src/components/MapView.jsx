import React, {
  useEffect,
  useRef,
  useState
} from 'react'

import maplibregl from 'maplibre-gl'

import { useStore } from '../store'
import { fetchSchedule } from '../api'
import { useTramAnimation } from '../hooks/UseTramAnimation'

export default function MapView() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  const markersRef = useRef([]) // Tram stop markers
  const parkingMarkersRef = useRef([]) // Parking markers
  const tramMarkersRef = useRef([]) // Animated tram markers

  const [scheduleData, setScheduleData] =
    useState(null)

  const {
    tramLines,
    parking,
    selectedLine,
    setSelectedStop,
    viewMode,
    voi,
    setSelectedVoi
  } = useStore()

  // Fetch selected line schedule
  useEffect(() => {
    if (!selectedLine) { setScheduleData(null); return }
    const id = selectedLine.replace(':', '_')
    const load = () => fetchSchedule(id).then(setScheduleData).catch(console.error)
    load()
    const t = setInterval(load, 1000)
    return () => clearInterval(t)
  }, [selectedLine])

  // Animated tram positions
  const tramPositions = useTramAnimation(
    tramLines,
    selectedLine,
    scheduleData
  )

  console.log('tramPositions:', tramPositions.length, tramPositions)

  // Highlight selected parking + center map
  useEffect(() => {
    return useStore.subscribe(
      state => state.selectedParking,
      selectedParking => {
        parkingMarkersRef.current.forEach(
          ({ el, parking: pm }) => {
            const isSelected =
              selectedParking?.id === pm.id

            if (isSelected) {
              el.classList.add(
                'parking-selected'
              )
            } else {
              el.classList.remove(
                'parking-selected'
              )
            }
          }
        )

        // Center map on selected parking
        if (selectedParking) {
          mapInstance.current?.flyTo({
            center: [
              selectedParking.lon,
              selectedParking.lat
            ],
            zoom: 16,
            speed: 1.2,
            curve: 1.4,
            essential: true
          })
        }
      }
    )
  }, [])

  // Initialize map
  useEffect(() => {
    mapInstance.current =
      new maplibregl.Map({
        container: mapRef.current,
        style:
          'https://tiles.openfreemap.org/styles/positron',
        center: [5.7245, 45.1885],
        zoom: 13
      })

    mapInstance.current.addControl(
      new maplibregl.NavigationControl(),
      'top-right'
    )

    return () =>
      mapInstance.current?.remove()
  }, [])

  // Draw tram lines
  useEffect(() => {
    const map = mapInstance.current

    if (!map || !tramLines.length) return

    const draw = () => {
      tramLines.forEach(line => {
        if (!line.geometry) return

        const id = `tram-${line.id}`

        const color =
          '#' + (line.color || 'ffffff')

        const isSelected =
          selectedLine === line.id

        if (map.getSource(id)) {
          map.setPaintProperty(
            id,
            'line-width',
            isSelected ? 6 : 3
          )

          map.setPaintProperty(
            id,
            'line-opacity',
            isSelected ? 1 : 0.5
          )
        } else {
          map.addSource(id, {
            type: 'geojson',
            data: line.geometry
          })

          map.addLayer({
            id,
            type: 'line',
            source: id,
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': color,
              'line-width': 3,
              'line-opacity': 0.7
            }
          })
        }

        // Visibility
        if (map.getLayer(id)) {
          map.setLayoutProperty(
            id,
            'visibility',
            viewMode === 'trams'
              ? 'visible'
              : 'none'
          )
        }
      })
    }

    if (map.isStyleLoaded()) draw()
    else map.on('load', draw)
  }, [
    tramLines,
    selectedLine,
    viewMode
  ])

  // Draw stop markers
  useEffect(() => {
    const map = mapInstance.current

    if (!map) return

    // Clear old stop markers
    markersRef.current.forEach(m =>
      m.remove()
    )

    markersRef.current = []

    if (!selectedLine) return

    const lineId = selectedLine.replace(
      ':',
      '_'
    )

    fetchSchedule(lineId)
      .then(data => {
        const stops =
          data['0']?.arrets || []

        const line = tramLines.find(
          l => l.id === selectedLine
        )

        const color =
          '#' + (line?.color || 'ffffff')

        stops.forEach(stop => {
          const el =
            document.createElement('div')

          el.style.cssText = `
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: white;
            border: 2px solid ${color};
            cursor: pointer;
            z-index: 999;
            visibility: ${
              viewMode === 'trams'
                ? 'visible'
                : 'hidden'
            };
          `

          // Stop click handler
          el.addEventListener(
            'click',
            e => {
              e.stopPropagation()

              useStore
                .getState()
                .setSelectedStop(stop)
            }
          )

          const marker =
            new maplibregl.Marker({
              element: el
            })
              .setLngLat([
                stop.lon,
                stop.lat
              ])
              .addTo(map)

          markersRef.current.push(marker)
        })
      })
      .catch(console.error)
  }, [
    selectedLine,
    tramLines,
    setSelectedStop,
    viewMode
  ])

  // Toggle stop marker visibility
  useEffect(() => {
    markersRef.current.forEach(m => {
      m.getElement().style.visibility =
        viewMode === 'trams'
          ? 'visible'
          : 'hidden'
    })
  }, [viewMode])

  // Animated tram markers
  useEffect(() => {
    const map = mapInstance.current

    if (!map) return

    // Clear old tram markers
    tramMarkersRef.current.forEach(m =>
      m.remove()
    )

    tramMarkersRef.current = []

    tramPositions.forEach(pos => {
      const el =
        document.createElement('div')

      el.style.cssText = `
        width: 16px; height: 16px; border-radius: 50%;
        background: ${pos.color};
        border: 3px solid white;
        box-shadow: 0 0 10px rgba(0,0,0,0.8);
        z-index: 500;
      `

      el.title = `${pos.stopA} → ${pos.stopB}`

      const marker =
        new maplibregl.Marker({
          element: el,
          anchor: 'center'
        })
          .setLngLat([
            pos.lon,
            pos.lat
          ])
          .addTo(map)

      tramMarkersRef.current.push(marker)
    })
  }, [tramPositions])

  // Draw parking markers
  useEffect(() => {
    const map = mapInstance.current

    if (!map || !parking.length) return

    const sensorParking =
      parking.filter(
        p =>
          p.lat &&
          p.lon &&
          p.has_sensor
      )

    const addMarkers = () => {
      // Only update colors if same count
      if (
        parkingMarkersRef.current
          .length ===
        sensorParking.length
      ) {
        parkingMarkersRef.current.forEach(
          ({ el, parking: pm }) => {
            const updated =
              sensorParking.find(
                p => p.id === pm.id
              )

            if (!updated) return

            const pct =
              updated.total > 0
                ? updated.free /
                  updated.total
                : 0

            const color =
              pct > 0.4
                ? '#4caf50'
                : pct > 0.15
                ? '#ff9800'
                : '#f44336'

            el.style.background = color
          }
        )

        return
      }

      // Full redraw if parking set changed
      parkingMarkersRef.current.forEach(
        ({ marker }) =>
          marker.remove()
      )

      parkingMarkersRef.current = []

      sensorParking.forEach(p => {
        const pct =
          p.total > 0
            ? p.free / p.total
            : 0

        const color =
          pct > 0.4
            ? '#4caf50'
            : pct > 0.15
              ? '#ff9800'
              : '#f44336'

        const el =
          document.createElement('div')

        el.innerHTML = `
          <div class="parking-marker-inner"></div>
        `

        el.style.cssText = `
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: ${color};
          border: 3px solid white;
          cursor: pointer;
          position: relative;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          visibility: ${
            viewMode === 'parking'
              ? 'visible'
              : 'hidden'
          };
          z-index: 1;
          transition: all 0.2s ease;
        `

        // Select parking
        el.addEventListener(
          'click',
          e => {
            e.stopPropagation()

            const current =
              useStore.getState()
                .selectedParking

            useStore
              .getState()
              .setSelectedParking(
                current?.id === p.id
                  ? null
                  : p
              )
          }
        )

        const popup =
          new maplibregl.Popup({
            offset: 14
          }).setHTML(`
            <div style="font-size:12px;color:#000">
              <b>${p.name}</b><br/>
              Free: ${p.free} / ${p.total}
            </div>
          `)

        const marker =
          new maplibregl.Marker({
            element: el,
            anchor: 'center'
          })
            .setLngLat([
              p.lon,
              p.lat
            ])
            .setPopup(popup)
            .addTo(map)

        parkingMarkersRef.current.push({
          marker,
          el,
          parking: p
        })
      })
    }

    if (map.isStyleLoaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [parking, viewMode])

  useEffect(() => {
    const map = mapInstance.current
    if (!map || !voi?.features) return

    const sourceId = 'voi'

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: voi
      })

      map.addLayer({
        id: 'voi-layer',
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'case',
            ['==', ['get', 'type'], 'voi_scooter'],
            '#e97325',
            '#553f15'
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      })

      map.setLayoutProperty(
        'voi-layer',
        'visibility',
        viewMode === 'voi' ? 'visible' : 'none'
      )

      map.on('click', 'voi-layer', (e) => {
        const feature = e.features[0]
      
        const props = feature.properties
        setSelectedVoi(props)
      })
      
    } else {
      map.getSource(sourceId).setData(voi)
    }
  }, [voi])

  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    if (map.getLayer('voi-layer')) {
      map.setLayoutProperty(
        'voi-layer',
        'visibility',
        viewMode === 'voi' ? 'visible' : 'none'
      )
    }
  }, [viewMode])

  // Toggle parking visibility
  useEffect(() => {
    parkingMarkersRef.current.forEach(
      ({ el }) => {
        el.style.visibility =
          viewMode === 'parking'
            ? 'visible'
            : 'hidden'
      }
    )
  }, [viewMode])

  return (
    <div
      ref={mapRef}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0
      }}
    />
  )
}
