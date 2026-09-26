'use client';

import type { Zone } from '@repo/shared';
import { useEffect, useRef, useState } from 'react';
import type { SyntheticPlot, ZoneFeatureCollection } from '@/fixtures/geo';
import { SPECIES_COLOR, SPECIES_LABEL } from '@/lib/species-colors';
import styles from './MapCanvas.module.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Free, no-API-key vector style + tiles (verified reachable: https://tiles.openfreemap.org/styles/liberty).
// See https://openfreemap.org — sponsored OpenMapTiles/OSM hosting, no account or key required.
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const INITIAL_CENTER: [number, number] = [141.6, 38.885]; // Kesennuma Bay / Karakuwa peninsula
const INITIAL_ZOOM = 11.4;

export interface ActiveFire {
  id: string;
  zone: Zone;
  label: string;
  firedOn: string;
}

interface MapCanvasProps {
  zoneFeatures: ZoneFeatureCollection;
  plots: SyntheticPlot[];
  selectedZone: Zone;
  activeFires: ActiveFire[];
}

function ringCentroid(ring: [number, number][]): [number, number] {
  const pts = ring.slice(0, -1); // last point closes the ring, same as the first
  const sum = pts.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

export function MapCanvas({ zoneFeatures, plots, selectedZone, activeFires }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const plotsGeoJson = {
    type: 'FeatureCollection' as const,
    features: plots.map((p) => ({
      type: 'Feature' as const,
      properties: { id: p.id, plotLabel: p.plotLabel, species: p.species, zone: p.zone, synthetic: true },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  };

  const firesGeoJson = {
    type: 'FeatureCollection' as const,
    features: activeFires.map((f, i) => {
      const zone = zoneFeatures.features.find((z) => z.properties.zone === f.zone);
      const [cx, cy] = zone ? ringCentroid(zone.geometry.coordinates[0]!) : [141.6, 38.885];
      const angle = (i / Math.max(activeFires.length, 1)) * Math.PI * 2;
      const jitter = activeFires.length > 1 ? 0.006 : 0;
      return {
        type: 'Feature' as const,
        properties: { label: f.label, firedOn: f.firedOn },
        geometry: {
          type: 'Point' as const,
          coordinates: [cx + Math.cos(angle) * jitter, cy + Math.sin(angle) * jitter],
        },
      };
    }),
  };

  // Init once.
  useEffect(() => {
    let cancelled = false;
    let cleanupMap: import('maplibre-gl').Map | undefined;

    (async () => {
      try {
        const { Map: MaplibreMap, Popup, NavigationControl } = await import('maplibre-gl');
        if (cancelled || !containerRef.current) return;

        const map = new MaplibreMap({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: INITIAL_CENTER,
          zoom: INITIAL_ZOOM,
          attributionControl: { compact: true },
        });
        cleanupMap = map;
        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;

        map.on('load', () => {
          if (cancelled) return;

          map.addSource('zones', { type: 'geojson', data: zoneFeatures as GeoJSON.GeoJSON });
          map.addLayer({
            id: 'zones-fill',
            type: 'fill',
            source: 'zones',
            paint: {
              'fill-color': ['case', ['==', ['get', 'zone'], selectedZone], '#3df0c9', '#7ba3ad'],
              'fill-opacity': ['case', ['==', ['get', 'zone'], selectedZone], 0.16, 0.07],
            },
          });
          map.addLayer({
            id: 'zones-outline',
            type: 'line',
            source: 'zones',
            paint: {
              'line-color': ['case', ['==', ['get', 'zone'], selectedZone], '#3df0c9', '#7ba3ad'],
              'line-width': ['case', ['==', ['get', 'zone'], selectedZone], 2.5, 1.2],
              'line-dasharray': [2, 1.5],
            },
          });

          map.addSource('plots', { type: 'geojson', data: plotsGeoJson as GeoJSON.GeoJSON });
          map.addLayer({
            id: 'plots-point',
            type: 'circle',
            source: 'plots',
            paint: {
              'circle-radius': 6,
              'circle-color': [
                'match',
                ['get', 'species'],
                'scallop',
                SPECIES_COLOR.scallop,
                'hoya',
                SPECIES_COLOR.hoya,
                'oyster',
                SPECIES_COLOR.oyster,
                '#ffffff',
              ],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#050f14',
            },
          });

          map.addSource('fires', { type: 'geojson', data: firesGeoJson as GeoJSON.GeoJSON });
          map.addLayer({
            id: 'fires-glow',
            type: 'circle',
            source: 'fires',
            paint: {
              'circle-radius': 18,
              'circle-color': '#ff6a42',
              'circle-opacity': 0.25,
              'circle-blur': 1,
            },
          });
          map.addLayer({
            id: 'fires-core',
            type: 'circle',
            source: 'fires',
            paint: { 'circle-radius': 5, 'circle-color': '#ff6a42', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff2ec' },
          });

          map.on('click', 'plots-point', (e) => {
            const f = e.features?.[0];
            if (!f || f.geometry.type !== 'Point') return;
            const p = f.properties as { plotLabel: string; species: string; zone: string };
            new Popup({ closeButton: false, offset: 10 })
              .setLngLat(f.geometry.coordinates as [number, number])
              .setHTML(
                `<div style="font-family:ui-monospace,monospace;font-size:0.85rem;line-height:1.5;color:#050f14">` +
                  `<b style="font-family:-apple-system,system-ui,sans-serif">${p.plotLabel}</b><br/>` +
                  `${SPECIES_LABEL[p.species as keyof typeof SPECIES_LABEL] ?? p.species} &middot; ${p.zone}<br/>` +
                  `<span style="opacity:0.7">synthetic plot — no real location</span></div>`,
              )
              .addTo(map);
          });
          map.on('mouseenter', 'plots-point', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'plots-point', () => {
            map.getCanvas().style.cursor = '';
          });

          setReady(true);
        });
      } catch (err) {
        if (!cancelled) setFailed(err instanceof Error ? err.message : 'map failed to load');
      }
    })();

    return () => {
      cancelled = true;
      cleanupMap?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; updates below use imperative setData
  }, []);

  // Keep zone highlight in sync with the selected zone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer('zones-fill')) {
      map.setPaintProperty('zones-fill', 'fill-color', ['case', ['==', ['get', 'zone'], selectedZone], '#3df0c9', '#7ba3ad']);
      map.setPaintProperty('zones-fill', 'fill-opacity', ['case', ['==', ['get', 'zone'], selectedZone], 0.16, 0.07]);
      map.setPaintProperty('zones-outline', 'line-color', ['case', ['==', ['get', 'zone'], selectedZone], '#3df0c9', '#7ba3ad']);
      map.setPaintProperty('zones-outline', 'line-width', ['case', ['==', ['get', 'zone'], selectedZone], 2.5, 1.2]);
    }
  }, [selectedZone, ready]);

  // Reveal fire markers as the timeline scrubs past their date.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('fires') as import('maplibre-gl').GeoJSONSource | undefined;
    source?.setData(firesGeoJson as GeoJSON.GeoJSON);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- firesGeoJson is a derived value, not a ref
  }, [ready, activeFires]);

  if (failed) {
    return (
      <div className={styles.wrap}>
        <div className={styles.fallback}>
          Map unavailable in this browser ({failed}). Zones: {zoneFeatures.features.map((f) => f.properties.label).join(', ')}.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.canvas} />
    </div>
  );
}
