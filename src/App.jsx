import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import './App.css'
import { useState, useRef } from 'react'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const createColoredIcon = (color, isDragging = false) => {
  return new L.DivIcon({
    html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 4px solid white; box-shadow: 0 0 15px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; cursor: ${isDragging ? 'grabbing' : 'grab'}; transform: ${isDragging ? 'scale(1.2)' : 'scale(1)'}; transition: transform 0.2s;">
      <div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>
    </div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  })
}

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#FFA500', '#00FFFF', '#FF1493', '#32CD32', '#FFD700', '#8B00FF']

function App() {
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState(null)
  const [showAddSite, setShowAddSite] = useState(false)
  const [viewMode, setViewMode] = useState('coverage')
  const [showResults, setShowResults] = useState(false)
  const [globalStats, setGlobalStats] = useState(null)
  const [draggingSiteId, setDraggingSiteId] = useState(null)
  const mapRef = useRef(null)
  
  // Nouveaux états pour les contrôles
  const [showSectors, setShowSectors] = useState(true)
  const [showCoverage, setShowCoverage] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [show3D, setShow3D] = useState(false)

  const [newSite, setNewSite] = useState({
    name: '',
    lat: 14.6928,
    lon: -17.4467,
    txPower: 43,
    frequency: 900,
    txAntennaGain: 18,
    txAntennaHeight: 30,
    rxAntennaHeight: 1.5,
    rxSensitivity: -104,
    fadeMargin: 10,
    cableLoss: 3,
    environment: 'urban',
    traffic: 25,
    numChannels: 8,
    azimuth: 0,
    beamwidth: 120,
    sectors: 1
  })

  // CORRECTION: Calcul du bilan de liaison
  const calculateLinkBudget = (site) => {
    const eirp = site.txPower + site.txAntennaGain - site.cableLoss
    const rxPowerMin = site.rxSensitivity
    const plMax = eirp - rxPowerMin - site.fadeMargin
    return { eirp, plMax }
  }

  // CORRECTION: Modèle Okumura-Hata corrigé
  const calculatePathLoss = (site, distance) => {
    if (distance < 0.1) return 50 // Distance minimale
    
    const f = site.frequency
    const hb = site.txAntennaHeight
    const hm = site.rxAntennaHeight

    // Facteur de correction pour la hauteur du mobile
    let aCorrectionFactor
    if (site.environment === 'urban') {
      if (f >= 400) {
        aCorrectionFactor = 3.2 * Math.pow(Math.log10(11.75 * hm), 2) - 4.97
      } else {
        aCorrectionFactor = (1.1 * Math.log10(f) - 0.7) * hm - (1.56 * Math.log10(f) - 0.8)
      }
    } else {
      aCorrectionFactor = (1.1 * Math.log10(f) - 0.7) * hm - (1.56 * Math.log10(f) - 0.8)
    }

    // Formule Okumura-Hata de base
    let pathLoss = 69.55 + 26.16 * Math.log10(f) - 13.82 * Math.log10(hb) - aCorrectionFactor + (44.9 - 6.55 * Math.log10(hb)) * Math.log10(distance)

    // Corrections environnementales
    if (site.environment === 'suburban') {
      pathLoss -= 2 * Math.pow(Math.log10(f / 28), 2) + 5.4
    } else if (site.environment === 'rural') {
      pathLoss -= 4.78 * Math.pow(Math.log10(f), 2) + 18.33 * Math.log10(f) - 40.94
    }

    return pathLoss
  }

  const erlangB = (traffic, channels) => {
    let erlang = 1.0
    for (let i = 1; i <= channels; i++) {
      erlang = (traffic * erlang) / (i + traffic * erlang)
    }
    return erlang
  }

  const kmToLatDegrees = (km) => km / 111.32
  const kmToLonDegrees = (km, lat) => km / (111.32 * Math.cos(lat * Math.PI / 180))

  const getColorForRSSI = (rssi) => {
    // Gradient plus vif et progressif
    if (rssi > -70) return '#00ff00'      // Vert brillant
    if (rssi > -75) return '#66ff00'      // Vert-jaune
    if (rssi > -80) return '#99ff00'      // Jaune-vert
    if (rssi > -85) return '#ccff00'      // Jaune clair
    if (rssi > -90) return '#ffff00'      // Jaune pur
    if (rssi > -95) return '#ffcc00'      // Jaune-orange
    if (rssi > -100) return '#ff9900'     // Orange
    if (rssi > -105) return '#ff6600'     // Orange-rouge
    if (rssi > -110) return '#ff3300'     // Rouge-orange
    return '#ff0000'                      // Rouge vif
  }

  // Fonction pour calculer les interférences
  const calculateInterference = (lat, lon) => {
    const signals = []
    
    sites.forEach(site => {
      // Calculer la distance entre le point et le site
      const dx = (lon - site.lon) * 111.32 * Math.cos(lat * Math.PI / 180)
      const dy = (lat - site.lat) * 111.32
      let distance = Math.sqrt(dx * dx + dy * dy)
      
      if (distance < 0.1) distance = 0.1
      
      // Calculer le RSSI pour ce site
      const pl = calculatePathLoss(site, distance)
      const rssi = site.txPower + site.txAntennaGain - site.cableLoss - pl
      
      signals.push({ rssi, siteId: site.id, frequency: site.frequency })
    })
    
    // Trier par puissance décroissante
    signals.sort((a, b) => b.rssi - a.rssi)
    
    // Signal le plus fort
    const strongest = signals[0]
    
    // Calculer les interférences co-canal (même fréquence)
    const coChannelInterference = signals
      .filter(s => s.frequency === strongest.frequency && s.siteId !== strongest.siteId)
      .reduce((sum, s) => sum + Math.pow(10, s.rssi / 10), 0)
    
    const cir = strongest.rssi - 10 * Math.log10(coChannelInterference || 0.000001)
    
    return {
      cir,
      dominantSite: strongest.siteId,
      numInterferors: signals.filter(s => s.siteId !== strongest.siteId && s.rssi > -100).length
    }
  }

  const getColorForCIR = (cir) => {
    // Gradient ultra-vif et progressif pour meilleure visualisation
    if (cir > 20) return '#00ff00'        // Vert fluo - Excellent
    if (cir > 18) return '#33ff33'        // Vert brillant
    if (cir > 16) return '#66ff66'        // Vert clair
    if (cir > 14) return '#99ff33'        // Vert-jaune
    if (cir > 12) return '#ccff00'        // Jaune-vert - Bon
    if (cir > 10) return '#ffff00'        // Jaune pur
    if (cir > 9) return '#ffcc00'         // Jaune-orange - Acceptable
    if (cir > 8) return '#ff9900'         // Orange
    if (cir > 7) return '#ff6600'         // Orange vif
    if (cir > 6) return '#ff3300'         // Orange-rouge - Mauvais
    if (cir > 5) return '#ff0033'         // Rouge-orange
    return '#ff0066'                      // Rouge-magenta - Critique
  }

  const handleAddSite = () => {
    if (!newSite.name.trim()) {
      alert('Veuillez entrer un nom pour le site')
      return
    }

    const siteWithId = {
      ...newSite,
      id: Date.now(),
      color: COLORS[sites.length % COLORS.length],
      coveragePoints: [],
      maxDistance: 0,
      results: null
    }

    const calculatedSite = calculateSiteCoverage(siteWithId)
    setSites([...sites, calculatedSite])
    
    setShowAddSite(false)
    setNewSite({
      name: '',
      lat: 14.6928,
      lon: -17.4467,
      txPower: 43,
      frequency: 900,
      txAntennaGain: 18,
      txAntennaHeight: 30,
      rxAntennaHeight: 1.5,
      rxSensitivity: -104,
      fadeMargin: 10,
      cableLoss: 3,
      environment: 'urban',
      traffic: 25,
      numChannels: 8,
      azimuth: 0,
      beamwidth: 120,
      sectors: 1
    })
  }

  // CORRECTION: Calcul de couverture avec ÉNORMÉMENT de points pour heatmap ultra-dense
  const calculateSiteCoverage = (site) => {
    const { plMax } = calculateLinkBudget(site)

    // Trouver la distance maximale de couverture
    let maxDistance = 0.1
    for (let d = 0.1; d <= 30; d += 0.05) {
      const pl = calculatePathLoss(site, d)
      if (pl <= plMax) {
        maxDistance = d
      } else {
        break
      }
    }

    // CORRECTION: Générer ÉNORMÉMENT de points pour une heatmap ultra-dense avec dégradé parfait
    const points = []
    const sectorsToGenerate = site.sectors || 1
    const anglePerSector = 360 / sectorsToGenerate

    for (let sector = 0; sector < sectorsToGenerate; sector++) {
      const sectorAzimuth = site.azimuth + (sector * anglePerSector)
      const startAngle = (sectorAzimuth - site.beamwidth / 2) * Math.PI / 180
      const endAngle = (sectorAzimuth + site.beamwidth / 2) * Math.PI / 180

      // AUGMENTATION DRASTIQUE pour un dégradé ultra-lisse
      const numCircles = 50  // 50 cercles concentriques (au lieu de 15)
      const numPointsPerArc = 100  // 100 points par arc (au lieu de 30)

      for (let circle = 1; circle <= numCircles; circle++) {
        const radius = (circle / numCircles) * maxDistance
        
        for (let i = 0; i <= numPointsPerArc; i++) {
          const angle = startAngle + (i / numPointsPerArc) * (endAngle - startAngle)
          const x = radius * Math.cos(angle)
          const y = radius * Math.sin(angle)
          
          const distance = Math.sqrt(x * x + y * y)
          if (distance < 0.1) continue

          const pl = calculatePathLoss(site, distance)
          const rssi = site.txPower + site.txAntennaGain - site.cableLoss - pl

          const lat = site.lat + kmToLatDegrees(y)
          const lon = site.lon + kmToLonDegrees(x, site.lat)

          points.push({
            lat,
            lon,
            rssi,
            distance: distance.toFixed(2),
            color: getColorForRSSI(rssi),
            sector
          })
        }
      }
    }

    const blockingProb = erlangB(site.traffic, site.numChannels)
    const capacity = site.numChannels * (1 - blockingProb)

    return {
      ...site,
      coveragePoints: points,
      maxDistance,
      results: {
        ...calculateLinkBudget(site),
        maxDistance: maxDistance.toFixed(2),
        cellArea: (Math.PI * maxDistance * maxDistance).toFixed(2),
        blockingProbability: (blockingProb * 100).toFixed(3),
        effectiveCapacity: capacity.toFixed(2)
      }
    }
  }

  const handleDeleteSite = (id) => {
    setSites(sites.filter(s => s.id !== id))
    if (selectedSite?.id === id) setSelectedSite(null)
  }

  const handleUpdateSite = (id, updates) => {
    const updatedSites = sites.map(site => {
      if (site.id === id) {
        const updated = { ...site, ...updates }
        return calculateSiteCoverage(updated)
      }
      return site
    })
    setSites(updatedSites)
    if (selectedSite?.id === id) {
      setSelectedSite(updatedSites.find(s => s.id === id))
    }
  }

  const calculateGlobalStats = () => {
    if (sites.length === 0) return

    const totalArea = sites.reduce((sum, site) => sum + parseFloat(site.results.cellArea), 0)
    const totalCapacity = sites.reduce((sum, site) => sum + parseFloat(site.results.effectiveCapacity), 0)
    const avgBlockingProb = sites.reduce((sum, site) => sum + parseFloat(site.results.blockingProbability), 0) / sites.length

    setGlobalStats({
      totalSites: sites.length,
      totalArea: totalArea.toFixed(2),
      totalCapacity: totalCapacity.toFixed(2),
      avgBlockingProb: avgBlockingProb.toFixed(3)
    })
    setShowResults(true)
  }

  const getSectorPolygon = (site) => {
    const sectorsToGenerate = site.sectors || 1
    const anglePerSector = 360 / sectorsToGenerate
    const polygons = []

    for (let sector = 0; sector < sectorsToGenerate; sector++) {
      const sectorAzimuth = site.azimuth + (sector * anglePerSector)
      const startAngle = (sectorAzimuth - site.beamwidth / 2) * Math.PI / 180
      const endAngle = (sectorAzimuth + site.beamwidth / 2) * Math.PI / 180
      
      const points = [[site.lat, site.lon]]
      const numPoints = 30
      
      for (let i = 0; i <= numPoints; i++) {
        const angle = startAngle + (i / numPoints) * (endAngle - startAngle)
        const x = site.maxDistance * Math.cos(angle)
        const y = site.maxDistance * Math.sin(angle)
        
        const lat = site.lat + kmToLatDegrees(y)
        const lon = site.lon + kmToLonDegrees(x, site.lat)
        points.push([lat, lon])
      }
      
      points.push([site.lat, site.lon])
      polygons.push(points)
    }

    return polygons
  }

  return (
    <div className="app">
      <div className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="3" fill="currentColor"/>
                <circle cx="20" cy="20" r="7" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"/>
                <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.4"/>
                <circle cx="20" cy="20" r="17" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.2"/>
                <rect x="18" y="20" width="4" height="12" fill="currentColor"/>
                <rect x="15" y="32" width="10" height="2" fill="currentColor"/>
              </svg>
            </div>
            <div>
              <h1>GSM Network Planning Tool</h1>
              <p>Professional Radio Coverage & Capacity Planning Platform</p>
            </div>
          </div>
          <div className="header-stats">
            <div className="stat-item">
              <span className="stat-label">Sites</span>
              <span className="stat-value">{sites.length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Mode</span>
              <span className="stat-value">{viewMode.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn-primary" onClick={() => setShowAddSite(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 2V14M2 8H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Ajouter Site
        </button>
        <button className="btn-secondary" onClick={calculateGlobalStats} disabled={sites.length === 0}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="10" width="3" height="4" fill="currentColor"/>
            <rect x="6.5" y="6" width="3" height="8" fill="currentColor"/>
            <rect x="11" y="2" width="3" height="12" fill="currentColor"/>
          </svg>
          Analyser
        </button>
        <button className="btn-secondary" onClick={() => {
          const data = {
            sites: sites.map(s => ({
              name: s.name,
              lat: s.lat,
              lon: s.lon,
              frequency: s.frequency,
              txPower: s.txPower,
              results: s.results
            }))
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'gsm_network.json'
          a.click()
        }} disabled={sites.length === 0}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 11V13C2 13.5304 2.21071 14.0391 2.58579 14.4142C2.96086 14.7893 3.46957 15 4 15H12C12.5304 15 13.0391 14.7893 13.4142 14.4142C13.7893 14.0391 14 13.5304 14 13V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 10V2M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Exporter
        </button>
        
        {/* TOGGLES DE VISUALISATION */}
        <div className="toggle-container">
          <span className="toggle-label">Secteurs</span>
          <div className={`toggle-switch ${showSectors ? 'active' : ''}`} onClick={() => setShowSectors(!showSectors)}>
            <div className="toggle-slider"></div>
          </div>
        </div>
        
        <div className="toggle-container">
          <span className="toggle-label">Couverture</span>
          <div className={`toggle-switch ${showCoverage ? 'active' : ''}`} onClick={() => setShowCoverage(!showCoverage)}>
            <div className="toggle-slider"></div>
          </div>
        </div>
        
        <div className="toggle-container">
          <span className="toggle-label">Labels</span>
          <div className={`toggle-switch ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels(!showLabels)}>
            <div className="toggle-slider"></div>
          </div>
        </div>
        
        <div className="view-mode-selector">
          <button className={viewMode === 'coverage' ? 'active' : ''} onClick={() => setViewMode('coverage')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="7" cy="7" r="2" fill="currentColor"/>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M7 1V3M7 11V13M1 7H3M11 7H13" stroke="currentColor" strokeWidth="1"/>
            </svg>
            Couverture
          </button>
          <button className={viewMode === 'interference' ? 'active' : ''} onClick={() => setViewMode('interference')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 2L8.5 6H12.5L9.25 8.5L10.75 12.5L7 10L3.25 12.5L4.75 8.5L1.5 6H5.5L7 2Z" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>
            Interférence
          </button>
          <button className={viewMode === 'all' ? 'active' : ''} onClick={() => setViewMode('all')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M1 5H13M5 1V13" stroke="currentColor" strokeWidth="1"/>
            </svg>
            Tout
          </button>
        </div>
      </div>

      <div className="main-container">
        <div className="sidebar">
          <h2>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '6px'}}>
              <rect x="5" y="8" width="4" height="5" fill="currentColor"/>
              <polygon points="7,2 3,7 11,7" fill="currentColor"/>
              <rect x="6" y="10" width="2" height="1" fill="var(--bg-tertiary)"/>
            </svg>
            Sites Actifs ({sites.length})
          </h2>
          <div className="sites-list">
            {sites.map(site => (
              <div key={site.id} className={`site-item ${selectedSite?.id === site.id ? 'selected' : ''}`} onClick={() => setSelectedSite(site)}>
                <div className="site-header">
                  <div className="site-color" style={{ backgroundColor: site.color }}></div>
                  <div className="site-name">{site.name}</div>
                  <button className="btn-delete" onClick={(e) => { e.stopPropagation(); handleDeleteSite(site.id); }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 4H12M5 4V3C5 2.44772 5.44772 2 6 2H8C8.55228 2 9 2.44772 9 3V4M3 4L4 12C4 12.5523 4.44772 13 5 13H9C9.55228 13 10 12.5523 10 12L11 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <line x1="6" y1="6" x2="6" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <line x1="8" y1="6" x2="8" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
                <div className="site-info">
                  <div>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="5" cy="3" r="2" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <path d="M5 5L5 8M3 8L7 8" stroke="currentColor" strokeWidth="1"/>
                    </svg>
                    {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
                  </div>
                  <div>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="5" cy="5" r="1.5" fill="currentColor"/>
                      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="0.7" fill="none"/>
                    </svg>
                    {site.frequency} MHz • {site.environment}
                  </div>
                  <div>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 8L5 2L8 8" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <line x1="3.5" y1="6" x2="6.5" y2="6" stroke="currentColor" strokeWidth="1"/>
                    </svg>
                    {site.results?.maxDistance} km
                  </div>
                  <div>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="6" width="2" height="3" fill="currentColor"/>
                      <rect x="4" y="4" width="2" height="5" fill="currentColor"/>
                      <rect x="7" y="2" width="2" height="7" fill="currentColor"/>
                    </svg>
                    {site.results?.effectiveCapacity} canaux
                  </div>
                </div>
              </div>
            ))}
            {sites.length === 0 && (
              <div className="empty-state">
                <p>Aucun site configuré</p>
                <p>Cliquez sur "Ajouter Site" pour commencer</p>
              </div>
            )}
          </div>
        </div>

        <div className="main-content">
          <div className="map-container">
            <MapContainer center={[14.6928, -17.4467]} zoom={12} style={{ height: '100%', width: '100%' }} ref={mapRef}>
              <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {sites.map(site => (
                <div key={site.id}>
                  <Marker 
                    position={[site.lat, site.lon]} 
                    icon={createColoredIcon(site.color, draggingSiteId === site.id)}
                    draggable={true}
                    eventHandlers={{
                      dragstart: () => {
                        setDraggingSiteId(site.id)
                      },
                      dragend: (e) => {
                        const marker = e.target
                        const position = marker.getLatLng()
                        handleUpdateSite(site.id, { 
                          lat: position.lat, 
                          lon: position.lng 
                        })
                        setDraggingSiteId(null)
                      },
                      click: () => {
                        setSelectedSite(site)
                      }
                    }}
                  >
                    <Popup>
                      <div className="popup-content">
                        <h3>{site.name}</h3>
                        <p><strong>Position:</strong> {site.lat.toFixed(5)}, {site.lon.toFixed(5)}</p>
                        <p><strong>Fréquence:</strong> {site.frequency} MHz</p>
                        <p><strong>Puissance:</strong> {site.txPower} dBm</p>
                        <p><strong>Hauteur:</strong> {site.txAntennaHeight} m</p>
                        <p><strong>Portée:</strong> {site.results?.maxDistance} km</p>
                        <p><strong>Capacité:</strong> {site.results?.effectiveCapacity} canaux</p>
                        <p style={{ marginTop: '8px', fontSize: '0.75em', color: '#6e7681', fontStyle: 'italic' }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '3px'}}>
                            <path d="M6 2L6 10M6 2L4 4M6 2L8 4M6 10L4 8M6 10L8 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Faites glisser pour déplacer le site
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                  {/* Secteurs - contrôlés par toggle */}
                  {showSectors && viewMode !== 'interference' && getSectorPolygon(site).map((polygon, idx) => (
                    <Polyline key={`sector-${site.id}-${idx}`} positions={polygon} pathOptions={{ color: site.color, weight: 2, opacity: 0.6, fillOpacity: 0.1, fillColor: site.color }} />
                  ))}
                  {/* Points de couverture - contrôlés par toggle - Opacité optimisée pour fondu */}
                  {showCoverage && (viewMode === 'coverage' || viewMode === 'all') && site.coveragePoints.map((point, idx) => (
                    <Circle
                      key={`point-${site.id}-${idx}`}
                      center={[point.lat, point.lon]}
                      radius={35}
                      pathOptions={{
                        color: point.color,
                        fillColor: point.color,
                        fillOpacity: 0.5,
                        weight: 0
                      }}
                    />
                  ))}
                  {viewMode !== 'interference' && (
                    <Circle center={[site.lat, site.lon]} radius={site.maxDistance * 1000} pathOptions={{ color: site.color, fillOpacity: 0, weight: 2, dashArray: '10, 10' }} />
                  )}
                </div>
              ))}

              {/* MODE INTERFÉRENCE: Afficher la carte C/I avec cercles concentriques ultra-denses */}
              {viewMode === 'interference' && sites.length >= 2 && (() => {
                const interferenceCircles = []
                
                // Pour chaque site, créer des cercles concentriques ultra-denses
                sites.forEach(site => {
                  const numRings = 20 // Plus d'anneaux pour un meilleur dégradé
                  const maxRadius = site.maxDistance
                  
                  for (let ring = 1; ring <= numRings; ring++) {
                    const radius = (ring / numRings) * maxRadius
                    const numPoints = 80 // Plus de points par anneau
                    
                    for (let i = 0; i < numPoints; i++) {
                      const angle = (i / numPoints) * 2 * Math.PI
                      const x = radius * Math.cos(angle)
                      const y = radius * Math.sin(angle)
                      
                      const lat = site.lat + kmToLatDegrees(y)
                      const lon = site.lon + kmToLonDegrees(x, site.lat)
                      
                      const interference = calculateInterference(lat, lon)
                      
                      interferenceCircles.push({
                        lat,
                        lon,
                        cir: interference.cir,
                        color: getColorForCIR(interference.cir),
                        numInterferors: interference.numInterferors,
                        radius: 60 // Rayon constant pour plus de densité
                      })
                    }
                  }
                })

                return interferenceCircles.map((point, idx) => (
                  <Circle
                    key={`interference-${idx}`}
                    center={[point.lat, point.lon]}
                    radius={point.radius}
                    pathOptions={{
                      color: point.color,
                      fillColor: point.color,
                      fillOpacity: 0.5,
                      weight: 0
                    }}
                  >
                    <Popup>
                      <strong>C/I Ratio:</strong> {point.cir.toFixed(2)} dB<br/>
                      <strong>Interférences:</strong> {point.numInterferors}<br/>
                      <strong>Qualité:</strong> {
                        point.cir > 18 ? '■ Excellente' :
                        point.cir > 12 ? '■ Bonne' :
                        point.cir > 9 ? '■ Acceptable' :
                        point.cir > 6 ? '■ Mauvaise' : '■ Critique'
                      }
                    </Popup>
                  </Circle>
                ))
              })()}
            </MapContainer>
            <div className="map-legend">
              <h4>{viewMode === 'interference' ? 'Rapport C/I (Carrier-to-Interference)' : 'Niveau de Signal (RSSI)'}</h4>
              <div className="legend-items">
                {viewMode === 'interference' ? (
                  <>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#00ff00' }}></div><span><span style={{color: '#00ff00', fontSize: '1.2em'}}>●</span> Excellent (&gt; 18 dB)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#99ff33' }}></div><span><span style={{color: '#99ff33', fontSize: '1.2em'}}>●</span> Bon (12-18 dB)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ffff00' }}></div><span><span style={{color: '#ffff00', fontSize: '1.2em'}}>●</span> Acceptable (9-12 dB)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ff6600' }}></div><span><span style={{color: '#ff6600', fontSize: '1.2em'}}>●</span> Mauvais (6-9 dB)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ff0066' }}></div><span><span style={{color: '#ff0066', fontSize: '1.2em'}}>●</span> Critique (&lt; 6 dB)</span></div>
                  </>
                ) : (
                  <>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#00ff00' }}></div><span>Excellent (&gt; -70 dBm)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#66ff00' }}></div><span>Très bon (-70 à -80 dBm)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ccff00' }}></div><span>Bon (-80 à -90 dBm)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ffff00' }}></div><span>Moyen (-90 à -95 dBm)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ff9900' }}></div><span>Faible (-95 à -105 dBm)</span></div>
                    <div className="legend-item"><div className="legend-color" style={{ backgroundColor: '#ff3300' }}></div><span>Très faible (&lt; -105 dBm)</span></div>
                  </>
                )}
              </div>
            </div>
          </div>

          {selectedSite && (
            <div className="details-panel">
              <div className="details-header">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '6px'}}>
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor"/>
                    <path d="M8 2V4M8 12V14M2 8H4M12 8H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Configuration: {selectedSite.name}
                </h3>
                <button onClick={() => setSelectedSite(null)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <div className="details-content">
                <div className="param-group">
                  <h4>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '4px'}}>
                      <circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <path d="M6 6.5L6 10M4 10L8 10" stroke="currentColor" strokeWidth="1"/>
                    </svg>
                    Localisation
                  </h4>
                  <div className="param-row"><label>Latitude</label><input type="number" step="0.0001" value={selectedSite.lat} onChange={(e) => handleUpdateSite(selectedSite.id, { lat: parseFloat(e.target.value) })} /></div>
                  <div className="param-row"><label>Longitude</label><input type="number" step="0.0001" value={selectedSite.lon} onChange={(e) => handleUpdateSite(selectedSite.id, { lon: parseFloat(e.target.value) })} /></div>
                </div>
                <div className="param-group">
                  <h4>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '4px'}}>
                      <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
                      <circle cx="6" cy="6" r="3.5" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="0.7" fill="none" opacity="0.5"/>
                    </svg>
                    Paramètres Radio
                  </h4>
                  <div className="param-row"><label>Fréquence (MHz)</label><select value={selectedSite.frequency} onChange={(e) => handleUpdateSite(selectedSite.id, { frequency: parseFloat(e.target.value) })}><option value="900">GSM 900</option><option value="1800">DCS 1800</option></select></div>
                  <div className="param-row"><label>Puissance TX (dBm)</label><input type="number" value={selectedSite.txPower} onChange={(e) => handleUpdateSite(selectedSite.id, { txPower: parseFloat(e.target.value) })} /></div>
                  <div className="param-row"><label>Gain antenne (dBi)</label><input type="number" value={selectedSite.txAntennaGain} onChange={(e) => handleUpdateSite(selectedSite.id, { txAntennaGain: parseFloat(e.target.value) })} /></div>
                  <div className="param-row"><label>Hauteur (m)</label><input type="number" value={selectedSite.txAntennaHeight} onChange={(e) => handleUpdateSite(selectedSite.id, { txAntennaHeight: parseFloat(e.target.value) })} /></div>
                </div>
                <div className="param-group">
                  <h4>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '4px'}}>
                      <path d="M6 2L10 6L6 10L2 6L6 2Z" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <circle cx="6" cy="6" r="1" fill="currentColor"/>
                    </svg>
                    Secteur
                  </h4>
                  <div className="param-row"><label>Azimuth (°)</label><input type="number" value={selectedSite.azimuth} onChange={(e) => handleUpdateSite(selectedSite.id, { azimuth: parseFloat(e.target.value) })} /></div>
                  <div className="param-row"><label>Ouverture (°)</label><input type="number" value={selectedSite.beamwidth} onChange={(e) => handleUpdateSite(selectedSite.id, { beamwidth: parseFloat(e.target.value) })} /></div>
                  <div className="param-row"><label>Nombre de secteurs</label><select value={selectedSite.sectors} onChange={(e) => handleUpdateSite(selectedSite.id, { sectors: parseInt(e.target.value) })}><option value="1">1 (Omnidirectionnel)</option><option value="3">3 (Tri-sectoriel)</option><option value="6">6 (Hexa-sectoriel)</option></select></div>
                </div>
                <div className="param-group">
                  <h4>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '4px'}}>
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <path d="M3 6C3 6 4.5 4 6 4C7.5 4 9 6 9 6" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <path d="M3 8C3 8 4.5 7 6 7C7.5 7 9 8 9 8" stroke="currentColor" strokeWidth="0.8" fill="none"/>
                    </svg>
                    Environnement
                  </h4>
                  <div className="param-row"><label>Type</label><select value={selectedSite.environment} onChange={(e) => handleUpdateSite(selectedSite.id, { environment: e.target.value })}><option value="urban">Urbain</option><option value="suburban">Suburbain</option><option value="rural">Rural</option></select></div>
                </div>
                <div className="results-summary">
                  <h4>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '4px'}}>
                      <rect x="1" y="7" width="2.5" height="4" fill="currentColor"/>
                      <rect x="4.75" y="5" width="2.5" height="6" fill="currentColor"/>
                      <rect x="8.5" y="2" width="2.5" height="9" fill="currentColor"/>
                    </svg>
                    Résultats
                  </h4>
                  <div className="result-item"><span>PIRE:</span><strong>{selectedSite.results?.eirp.toFixed(2)} dBm</strong></div>
                  <div className="result-item"><span>Portée max:</span><strong>{selectedSite.results?.maxDistance} km</strong></div>
                  <div className="result-item"><span>Surface:</span><strong>{selectedSite.results?.cellArea} km²</strong></div>
                  <div className="result-item"><span>Capacité:</span><strong>{selectedSite.results?.effectiveCapacity} canaux</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddSite && (
        <div className="modal-overlay" onClick={() => setShowAddSite(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '6px'}}>
                  <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  <path d="M9 5V13M5 9H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Nouveau Site
              </h2>
              <button onClick={() => setShowAddSite(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 5L13 13M13 5L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-content">
              <div className="form-row"><label>Nom du site *</label><input type="text" value={newSite.name} onChange={(e) => setNewSite({...newSite, name: e.target.value})} placeholder="Ex: BTS-Plateau-01" /></div>
              <div className="form-row-group">
                <div className="form-row"><label>Latitude</label><input type="number" step="0.0001" value={newSite.lat} onChange={(e) => setNewSite({...newSite, lat: parseFloat(e.target.value)})} /></div>
                <div className="form-row"><label>Longitude</label><input type="number" step="0.0001" value={newSite.lon} onChange={(e) => setNewSite({...newSite, lon: parseFloat(e.target.value)})} /></div>
              </div>
              <div className="form-row-group">
                <div className="form-row"><label>Fréquence</label><select value={newSite.frequency} onChange={(e) => setNewSite({...newSite, frequency: parseFloat(e.target.value)})}><option value="900">GSM 900 MHz</option><option value="1800">DCS 1800 MHz</option></select></div>
                <div className="form-row"><label>Environnement</label><select value={newSite.environment} onChange={(e) => setNewSite({...newSite, environment: e.target.value})}><option value="urban">Urbain</option><option value="suburban">Suburbain</option><option value="rural">Rural</option></select></div>
              </div>
              <div className="form-row-group">
                <div className="form-row"><label>Puissance TX (dBm)</label><input type="number" value={newSite.txPower} onChange={(e) => setNewSite({...newSite, txPower: parseFloat(e.target.value)})} /></div>
                <div className="form-row"><label>Gain antenne (dBi)</label><input type="number" value={newSite.txAntennaGain} onChange={(e) => setNewSite({...newSite, txAntennaGain: parseFloat(e.target.value)})} /></div>
              </div>
              <div className="form-row"><label>Nombre de secteurs</label><select value={newSite.sectors} onChange={(e) => setNewSite({...newSite, sectors: parseInt(e.target.value)})}><option value="1">1 - Omnidirectionnel</option><option value="3">3 - Tri-sectoriel</option><option value="6">6 - Hexa-sectoriel</option></select></div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddSite(false)}>Annuler</button>
              <button className="btn-primary" onClick={handleAddSite}>Créer Site</button>
            </div>
          </div>
        </div>
      )}

      {showResults && globalStats && (
        <div className="modal-overlay" onClick={() => setShowResults(false)}>
          <div className="modal results-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display: 'inline-block', verticalAlign: 'middle', marginRight: '6px'}}>
                  <rect x="2" y="10" width="3.5" height="6" fill="currentColor"/>
                  <rect x="7.25" y="6" width="3.5" height="10" fill="currentColor"/>
                  <rect x="12.5" y="2" width="3.5" height="14" fill="currentColor"/>
                </svg>
                Analyse Globale du Réseau
              </h2>
              <button onClick={() => setShowResults(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 5L13 13M13 5L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-content">
              <div className="global-stats">
                <div className="stat-card blue">
                  <div className="stat-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="12" y="16" width="8" height="12" fill="currentColor" opacity="0.8"/>
                      <polygon points="16,6 8,14 24,14" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="stat-info"><div className="stat-label">Sites Actifs</div><div className="stat-number">{globalStats.totalSites}</div></div>
                </div>
                <div className="stat-card green">
                  <div className="stat-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="16" cy="16" r="4" fill="currentColor"/>
                      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"/>
                      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3"/>
                    </svg>
                  </div>
                  <div className="stat-info"><div className="stat-label">Surface Totale</div><div className="stat-number">{globalStats.totalArea} km²</div></div>
                </div>
                <div className="stat-card orange">
                  <div className="stat-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="4" y="18" width="6" height="10" fill="currentColor"/>
                      <rect x="13" y="12" width="6" height="16" fill="currentColor"/>
                      <rect x="22" y="6" width="6" height="22" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="stat-info"><div className="stat-label">Capacité Totale</div><div className="stat-number">{globalStats.totalCapacity} canaux</div></div>
                </div>
                <div className="stat-card purple">
                  <div className="stat-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
                      <path d="M16 10V16L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="stat-info"><div className="stat-label">Blocage Moyen</div><div className="stat-number">{globalStats.avgBlockingProb}%</div></div>
                </div>
              </div>
              <div className="sites-table">
                <h3>Détails par Site</h3>
                <table>
                  <thead><tr><th>Site</th><th>Fréq.</th><th>Portée</th><th>Surface</th><th>Capacité</th><th>Blocage</th></tr></thead>
                  <tbody>
                    {sites.map(site => (
                      <tr key={site.id}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: site.color }}></div>{site.name}</div></td>
                        <td>{site.frequency} MHz</td>
                        <td>{site.results?.maxDistance} km</td>
                        <td>{site.results?.cellArea} km²</td>
                        <td>{site.results?.effectiveCapacity} canaux</td>
                        <td>{site.results?.blockingProbability}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App