import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { FloodIncident, HotspotZone, SeverityLevel } from '../types';
import { ShieldAlert, Crosshair, Layers, Loader2, AlertCircle, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';

interface MapViewProps {
  incidents: FloodIncident[];
  hotspots: HotspotZone[];
  selectedIncident: FloodIncident | null;
  onSelectIncident: (incident: FloodIncident) => void;
  selectedCity: string;
  isPinDropping: boolean;
  droppedCoords: [number, number] | null;
  onMapClickDropPin: (coords: [number, number]) => void;
  showHotspots: boolean;
  onToggleHotspots: () => void;
}

const CITY_COORDINATES: Record<string, { center: [number, number]; zoom: number }> = {
  all: { center: [20.5937, 78.9629], zoom: 5 },
  Mumbai: { center: [19.0760, 72.8777], zoom: 12 },
  Bengaluru: { center: [12.9716, 77.5946], zoom: 12 },
  Chennai: { center: [13.0827, 80.2707], zoom: 12 },
  'Delhi NCR': { center: [28.6139, 77.2090], zoom: 12 },
  Hyderabad: { center: [17.3850, 78.4867], zoom: 12 },
};

export const MapView: React.FC<MapViewProps> = ({
  incidents,
  hotspots,
  selectedIncident,
  onSelectIncident,
  selectedCity,
  isPinDropping,
  droppedCoords,
  onMapClickDropPin,
  showHotspots,
  onToggleHotspots,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hotspotsLayerRef = useRef<L.LayerGroup | null>(null);
  const dropPinMarkerRef = useRef<L.Marker | null>(null);

  const [isTilesLoading, setIsTilesLoading] = useState(true);
  const [tileErrorOccurred, setTileErrorOccurred] = useState(false);

  // Keep latest callback references to prevent stale closures in Leaflet listeners
  const onMapClickDropPinRef = useRef(onMapClickDropPin);
  useEffect(() => {
    onMapClickDropPinRef.current = onMapClickDropPin;
  }, [onMapClickDropPin]);

  const onSelectIncidentRef = useRef(onSelectIncident);
  useEffect(() => {
    onSelectIncidentRef.current = onSelectIncident;
  }, [onSelectIncident]);

  // Set up global bridge for popup button clicks
  useEffect(() => {
    (window as any).__floodlens_select_incident = (id: string) => {
      const match = incidents.find((i) => i.id === id);
      if (match) {
        onSelectIncidentRef.current(match);
      }
    };
    return () => {
      delete (window as any).__floodlens_select_incident;
    };
  }, [incidents]);

  // Initialize Leaflet map with standard OpenStreetMap (NO API KEY REQUIRED)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const normalized = (selectedCity || '').trim().toLowerCase();
    const matchedKey = Object.keys(CITY_COORDINATES).find(
      (k) => k.toLowerCase() === normalized
    );
    const initialConfig = matchedKey ? CITY_COORDINATES[matchedKey] : CITY_COORDINATES['Mumbai'];

    const map = L.map(mapContainerRef.current, {
      center: initialConfig.center,
      zoom: initialConfig.zoom,
      zoomControl: false,
      attributionControl: true,
    });

    // Custom zoom control placement at bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Standard OpenStreetMap Tile URL with multiple subdomains for high availability
    const osmTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      crossOrigin: true,
    });

    osmTileLayer.on('loading', () => {
      setIsTilesLoading(true);
    });

    osmTileLayer.on('load', () => {
      setIsTilesLoading(false);
      setTileErrorOccurred(false);
    });

    osmTileLayer.on('tileerror', (error) => {
      console.warn('OpenStreetMap tile loading latency/error:', error);
      setTileErrorOccurred(true);
      setIsTilesLoading(false);
    });

    osmTileLayer.addTo(map);
    tileLayerRef.current = osmTileLayer;

    markersLayerRef.current = L.layerGroup().addTo(map);
    hotspotsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickDropPinRef.current([e.latlng.lat, e.latlng.lng]);
    });

    mapInstanceRef.current = map;

    // Trigger initial invalidateSize
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    // ResizeObserver ensures map adjusts whenever container size changes
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(timer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if (mapContainerRef.current) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }
    };
  }, []);

  // Pan to selected city when city filter changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const normalized = (selectedCity || '').trim().toLowerCase();
    const matchedKey = Object.keys(CITY_COORDINATES).find(
      (k) => k.toLowerCase() === normalized
    );
    const config = matchedKey ? CITY_COORDINATES[matchedKey] : CITY_COORDINATES['all'];

    if (config) {
      mapInstanceRef.current.flyTo(config.center, config.zoom, {
        duration: 1.0,
      });
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 300);
    }
  }, [selectedCity]);

  // Center on selected incident
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedIncident) return;
    mapInstanceRef.current.flyTo(selectedIncident.coordinates, 14, {
      duration: 1.0,
      easeLinearity: 0.25,
    });
  }, [selectedIncident]);

  // Update incident markers
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    incidents.forEach((incident) => {
      const isSelected = selectedIncident?.id === incident.id;
      const severity = incident.severity;

      let colorClass = 'bg-teal-700 border-teal-800 shadow-teal-500/20';
      let pulseClass = 'custom-pulse-low';
      let dotColor = '#0F766E';

      if (severity === 'high') {
        colorClass = 'bg-red-600 border-red-700 shadow-red-500/40';
        pulseClass = 'custom-pulse-high';
        dotColor = '#DC2626';
      } else if (severity === 'moderate') {
        colorClass = 'bg-amber-500 border-amber-600 shadow-amber-500/30';
        pulseClass = 'custom-pulse-mod';
        dotColor = '#D97706';
      }

      const iconHtml = `
        <div class="relative flex items-center justify-center cursor-pointer group" style="transform: translate3d(0,0,0);">
          <div class="absolute -inset-2 rounded-full ${pulseClass} opacity-85"></div>
          <div class="relative flex flex-col items-center">
            <div class="px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-md border flex items-center gap-1 ${colorClass} ${
              isSelected ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'hover:scale-105'
            } transition-transform">
              <span class="w-1.5 h-1.5 rounded-full bg-white ${severity === 'high' ? 'animate-ping' : ''}"></span>
              <span class="font-mono tabular-nums">${incident.waterDepthCm}cm</span>
            </div>
            <div class="w-2 h-2 rotate-45 -mt-1 ${colorClass} border-r border-b"></div>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-flood-marker',
        html: iconHtml,
        iconSize: [64, 40],
        iconAnchor: [32, 32],
      });

      const marker = L.marker(incident.coordinates, { icon: customIcon });

      const popupHtml = `
        <div class="p-1 font-sans max-w-[260px]">
          <div class="flex items-center justify-between text-[11px] text-slate-500 pb-1 mb-1 border-b border-slate-100">
            <span class="font-semibold text-slate-800">${incident.city} · ${incident.wardOrDistrict}</span>
            <span class="font-bold text-[10px] uppercase px-1.5 py-0.2 rounded" style="color: ${dotColor}; background-color: ${dotColor}15">${severity}</span>
          </div>
          <h4 class="text-xs font-bold text-slate-900 leading-tight mb-1">${incident.title}</h4>
          <p class="text-[11px] text-slate-600 mb-2 line-clamp-2">${incident.description}</p>
          <div class="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200 text-[10px] mb-1.5">
            <div>
              <span class="text-slate-500 block">TrustScore</span>
              <span class="font-bold text-teal-800 font-mono text-xs">${incident.trustScore.score}%</span>
            </div>
            <div class="text-right">
              <span class="text-slate-500 block">${incident.isSampleData ? 'Water Depth (Demo)' : 'Recorded Depth'}</span>
              <span class="font-bold text-slate-900 font-mono text-xs">${incident.waterDepthCm} cm</span>
            </div>
          </div>
          <div class="text-[10px] text-center font-medium py-1 px-1.5 rounded ${
            incident.isSampleData 
              ? 'text-amber-800 bg-amber-50 border border-amber-200' 
              : 'text-emerald-800 bg-emerald-50 border border-emerald-200'
          }">
            ${incident.isSampleData ? '⚠️ Simulated Scenario (Demo)' : '🛡️ Live Citizen Report'}
          </div>
          <button 
            onclick="window.__floodlens_select_incident && window.__floodlens_select_incident('${incident.id}')"
            class="mt-2 w-full py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-[11px] rounded-lg transition-colors cursor-pointer text-center block"
          >
            Inspect Incident & Corroborate
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml, { closeButton: true, offset: [0, -22] });

      marker.on('click', () => {
        onSelectIncidentRef.current(incident);
      });

      markersLayerRef.current?.addLayer(marker);
    });
  }, [incidents, selectedIncident]);

  // Update Hotspots Layer
  useEffect(() => {
    if (!mapInstanceRef.current || !hotspotsLayerRef.current) return;

    hotspotsLayerRef.current.clearLayers();

    if (showHotspots) {
      hotspots.forEach((hs) => {
        const circle = L.circle(hs.coordinates, {
          color: '#475569',
          fillColor: '#94A3B8',
          fillOpacity: 0.16,
          radius: 450,
          weight: 1.5,
          dashArray: '4, 4',
        });

        const hotspotMarker = L.divIcon({
          className: 'hotspot-zone-marker',
          html: `
            <div class="px-2 py-0.5 bg-slate-900 text-slate-100 text-[10px] font-semibold rounded shadow border border-slate-700 flex items-center gap-1 opacity-90 whitespace-nowrap">
              <span>⚠️ ${hs.name}</span>
            </div>
          `,
          iconSize: [120, 20],
          iconAnchor: [60, 10],
        });

        const label = L.marker(hs.coordinates, { icon: hotspotMarker });

        circle.bindTooltip(`
          <div class="text-xs p-1">
            <strong>Chronic Hotspot (Demo): ${hs.name}</strong><br/>
            Priority: ${hs.inspectionPriority}<br/>
            Drainage: ${hs.drainageStatus}
          </div>
        `);

        hotspotsLayerRef.current?.addLayer(circle);
        hotspotsLayerRef.current?.addLayer(label);
      });
    }
  }, [hotspots, showHotspots]);

  // Render Dropped Pin for reporting mode
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (droppedCoords) {
      if (dropPinMarkerRef.current) {
        dropPinMarkerRef.current.setLatLng(droppedCoords);
      } else {
        const pinIcon = L.divIcon({
          className: 'drop-pin-marker',
          html: `
            <div class="flex flex-col items-center animate-bounce">
              <div class="bg-teal-700 text-white p-2 rounded-full shadow-xl border-2 border-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              </div>
              <span class="bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow mt-1 whitespace-nowrap">Report Pin</span>
            </div>
          `,
          iconSize: [40, 50],
          iconAnchor: [20, 48],
        });

        dropPinMarkerRef.current = L.marker(droppedCoords, { icon: pinIcon }).addTo(mapInstanceRef.current);
      }
    } else {
      if (dropPinMarkerRef.current) {
        dropPinMarkerRef.current.remove();
        dropPinMarkerRef.current = null;
      }
    }
  }, [droppedCoords]);

  const handleRetryTiles = () => {
    if (tileLayerRef.current) {
      tileLayerRef.current.redraw();
      setTileErrorOccurred(false);
      setIsTilesLoading(true);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[460px] bg-slate-100 rounded-xl overflow-hidden border border-slate-200/90 shadow-xs">
      {/* Map Target Canvas */}
      <div 
        ref={mapContainerRef} 
        className={`w-full h-full ${isPinDropping ? 'cursor-crosshair' : ''}`} 
      />

      {/* Loading Indicator for Tiles */}
      {isTilesLoading && (
        <div className="absolute top-3 right-3 z-[400] bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-md border border-slate-200 shadow-xs flex items-center gap-1.5 text-xs text-slate-600 pointer-events-none">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />
          <span>Loading OpenStreetMap tiles...</span>
        </div>
      )}

      {/* Tile Error Message Fallback (if network fails) */}
      {tileErrorOccurred && (
        <div className="absolute top-14 left-3 right-3 z-[400] bg-amber-50/95 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900 flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Map tiles may be slow to resolve. Interactive flood markers remain active and clickable.</span>
          </div>
          <button
            onClick={handleRetryTiles}
            className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Top Map Controls Floating Bar */}
      <div className="absolute top-3 left-3 z-[400] flex flex-wrap items-center gap-2 pointer-events-auto">
        <button
          onClick={onToggleHotspots}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all backdrop-blur-md shadow-xs cursor-pointer ${
            showHotspots
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
          title="Toggle recurring flood vulnerable zones"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Vulnerable Hotspots {showHotspots ? 'On' : 'Off'}</span>
        </button>

        {isPinDropping && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-teal-800 text-teal-50 rounded-lg shadow-md border border-teal-700 animate-pulse">
            <Crosshair className="w-3.5 h-3.5" />
            <span>Click on map to drop precise report location</span>
          </div>
        )}
      </div>

      {/* Map Legend Overlay */}
      <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg p-2.5 shadow-xs text-xs space-y-1.5 max-w-[210px] pointer-events-auto hidden sm:block">
        <div className="text-[11px] font-bold text-slate-800 flex items-center justify-between pb-1 border-b border-slate-100">
          <span>Flood Depth Severity</span>
          <span className="text-[10px] text-slate-500 font-mono">Status</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-red-100 animate-pulse"></span>
            <span className="font-semibold text-red-900">High Danger</span>
          </div>
          <span className="font-mono text-[11px] text-red-700 font-bold">&gt;50cm</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-100"></span>
            <span>Moderate</span>
          </div>
          <span className="font-mono text-[11px] text-slate-600">25–50cm</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-600 ring-2 ring-teal-100"></span>
            <span>Low / Caution</span>
          </div>
          <span className="font-mono text-[11px] text-slate-600">&lt;25cm</span>
        </div>
        <div className="pt-1 border-t border-slate-100 text-[9px] text-slate-400">
          OpenStreetMap · FloodLens Engine
        </div>
      </div>

      {/* Mandatory Civic Safety Notice Ribbon */}
      <div className="absolute bottom-2 right-12 z-[400] bg-slate-900/90 backdrop-blur-xs text-slate-200 text-[10px] px-2.5 py-1 rounded-md border border-slate-700/80 shadow-md pointer-events-auto max-w-[380px] hidden md:flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="truncate">
          Civic Advisory: Unmarked roads are not guaranteed dry. Never enter standing floodwater.
        </span>
      </div>
    </div>
  );
};
