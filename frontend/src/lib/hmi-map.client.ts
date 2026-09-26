import L from 'leaflet';

type Plot = { plotCode: string; centroid: [number, number]; geometry: GeoJSON.Geometry; species: string[]; source: string };
type Zone = { geometry: GeoJSON.Geometry | null; name: string; nameJa?: string | null };

const ENGLISH: Record<string, string> = {
  draw: 'Draw area', cancel: 'Finish drawing', help: 'Click the map to add 3 or more points, then analyze.',
  extent: 'Area limited to the mapped Miyagi coast.', sampling: 'Sampling satellite temperature data…',
  noData: 'No valid temperature data.', areaFailed: 'Area analysis unavailable.',
  tilesFailed: 'Map tiles failed to load. Plot and observation data remain available.',
  loading: 'Loading observations…', loaded: 'loaded', updateFailed: 'Could not update observations. Try again.',
  panelFailed: 'Observations could not be updated.', outlines: 'Outlines only', satelliteNote: 'Satellite · Esri',
  overlayUnavailable: '{layer} imagery is unavailable for {time}.', sst: 'Sea temperature', anom: 'Temp anomaly', chl: 'Chlorophyll',
};

export function initHmiMap(root: ParentNode = document) {
const scene = root.querySelector<HTMLElement>('.hmi-page');
const mapElement = scene?.querySelector<HTMLElement>('#hmi-map');
if (scene && mapElement && !scene.dataset.mapReady) {
  scene.dataset.mapReady = 'true';
  const copy = { ...ENGLISH, ...JSON.parse(scene.dataset.copy ?? '{}') as Record<string, string> };
  const lang = scene.dataset.lang === 'ja' ? 'ja' : 'en';
  const features = JSON.parse(scene.dataset.mapFeatures ?? '{"plots":[],"zones":[]}') as { plots: Plot[]; zones: Zone[] };
  const dock = scene.querySelector<HTMLFormElement>('.coast-dock')!;
  const status = scene.querySelector<HTMLElement>('[data-view-status]')!;
  const seasonInput = dock.elements.namedItem('season') as HTMLInputElement;
  const plotInput = scene.querySelector<HTMLSelectElement>('select[name="plot"]')!;
  const selectedSpecies = () => (dock.querySelector<HTMLInputElement>('input[name="species"]:checked')?.value ?? '');
  const map = L.map(mapElement, { minZoom: 5, maxZoom: 16, zoomControl: false, scrollWheelZoom: false, attributionControl: false }).setView([38.84, 141.61], 10);
  // Bottom-left and lifted above the dock (hmi.css), so attribution is never covered by the dock or the observations toggle.
  L.control.attribution({ position: 'bottomleft' }).addTo(map);
  map.setMaxBounds([[36.8, 139.9], [41.0, 143.7]]);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, GIS User Community',
  }).addTo(map);
  const activeOverlays = new Map<string, L.TileLayer>();
  const layers: Record<string, { name: string; label: string }> = {
    sst: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature', label: copy.sst },
    anom: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', label: copy.anom },
    chl: { name: 'OCI_PACE_Chlorophyll_a', label: copy.chl },
  };
  const layerNote = scene.querySelector<HTMLElement>('[data-layer-date]')!;
  const chlorophyllNote = scene.querySelector<HTMLElement>('[data-chlorophyll-note]')!;
  const mapMessage = scene.querySelector<HTMLElement>('[data-map-message]')!;
  const mapMessageText = scene.querySelector<HTMLElement>('[data-map-message-text]')!;
  const retryButton = scene.querySelector<HTMLButtonElement>('[data-map-retry]')!;
  const layerInputs = [...scene.querySelectorAll<HTMLInputElement>('input[name="map-layer"]')];
  const markerByCode = new Map<string, { marker: L.CircleMarker; plot: Plot }>();
  let drawing = false;
  let busy = false;

  const showMessage = (text: string, retry = false) => {
    mapMessageText.textContent = text;
    retryButton.hidden = !retry;
    mapMessage.hidden = false;
  };

  // Tile failures: show a status with Retry once a visible layer fails twice; plot and observation panels stay usable.
  let tileFailures = 0;
  const watchTiles = (layer: L.TileLayer, failure: () => string) => layer
    .on('loading', () => { tileFailures = 0; })
    .on('tileerror', () => {
      if (!map.hasLayer(layer)) return;
      tileFailures += 1;
      if (tileFailures >= 2) showMessage(failure(), true);
    });
  watchTiles(imagery, () => copy.tilesFailed);
  retryButton.addEventListener('click', () => {
    tileFailures = 0;
    mapMessage.hidden = true;
    if (map.hasLayer(imagery)) imagery.redraw();
    activeOverlays.forEach((overlay) => overlay.redraw());
  });

  for (const zone of features.zones) {
    if (zone.geometry) L.geoJSON(zone.geometry, { style: { color: '#f7f5df', weight: 1.5, fillColor: '#f7f5df', fillOpacity: 0.05 } }).addTo(map);
  }
  for (const plot of features.plots) {
    const marker = L.circleMarker([plot.centroid[1], plot.centroid[0]], {
      radius: 4, weight: 1, color: '#fff', fillColor: '#f7a32f', fillOpacity: 1,
    });
    marker.bindTooltip(plot.plotCode);
    marker.on('click', () => {
      if (drawing || busy) return;
      if (!plot.species.includes(selectedSpecies())) {
        const option = dock.querySelector<HTMLInputElement>(`input[name="species"][value="${plot.species[0]}"]`);
        if (option) option.checked = true;
      }
      void updateView({ plot: plot.plotCode });
    });
    markerByCode.set(plot.plotCode, { marker, plot });
  }
  const points = features.plots.map((plot) => [plot.centroid[1], plot.centroid[0]] as [number, number]);
  if (points.length) map.fitBounds(points, { padding: [70, 70], maxZoom: 12 });
  const selectedMarker = () => {
    markerByCode.forEach(({ marker, plot }, code) => {
      const visible = code === plotInput.value && plot.species.includes(selectedSpecies());
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
      marker.setStyle({ radius: code === plotInput.value ? 7 : 4, weight: code === plotInput.value ? 2 : 1 });
    });
  };
  selectedMarker();

  function openShelf(name: string | null) {
    scene!.querySelectorAll<HTMLElement>('.map-shelf').forEach((shelf) => {
      const open = shelf.id === `${name}-shelf`;
      shelf.toggleAttribute('data-open', open);
      shelf.inert = !open;
    });
    scene!.querySelectorAll<HTMLButtonElement>('[data-shelf]').forEach((button) => {
      button.setAttribute('aria-expanded', String(button.dataset.shelf === name));
    });
    if (name !== 'area' && drawing) setDrawing(false);
  }
  scene.querySelectorAll<HTMLButtonElement>('[data-shelf]').forEach((button) => button.addEventListener('click', () => {
    openShelf(button.getAttribute('aria-expanded') === 'true' ? null : button.dataset.shelf ?? null);
  }));
  scene.querySelectorAll<HTMLButtonElement>('[data-close-shelf]').forEach((button) => button.addEventListener('click', () => openShelf(null)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') openShelf(null); });

  function renderMapLayers() {
    mapMessage.hidden = true;
    tileFailures = 0;
    const satellite = layerInputs.find((input) => input.value === 'satellite')?.checked ?? false;
    if (satellite && !map.hasLayer(imagery)) imagery.addTo(map);
    if (!satellite && map.hasLayer(imagery)) map.removeLayer(imagery);
    activeOverlays.forEach((overlay) => map.removeLayer(overlay));
    activeOverlays.clear();
    const selected = layerInputs.filter((input) => input.checked && input.value !== 'satellite');
    const time = `${seasonInput.value}-10-31`;
    selected.forEach((input) => {
      const layer = layers[input.value];
      if (!layer) return;
      const overlay = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: layer.name, format: 'image/png', transparent: true,
        opacity: selected.length > 1 ? 0.28 : 0.65, version: '1.1.1', time,
        attribution: '&copy; NASA GIBS',
      } as L.WMSOptions);
      watchTiles(overlay, () => copy.overlayUnavailable.replace('{layer}', layer.label).replace('{time}', time));
      activeOverlays.set(input.value, overlay.addTo(map));
    });
    layerNote.textContent = selected.length ? `NASA GIBS · ${time}` : satellite ? copy.satelliteNote : copy.outlines;
    chlorophyllNote.hidden = !selected.some((input) => input.value === 'chl');
  }
  layerInputs.forEach((input) => input.addEventListener('change', renderMapLayers));
  scene.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.zoom === 'in') map.zoomIn(); else map.zoomOut();
  }));
  scene.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((button) => button.addEventListener('click', () => {
    const year = Number(seasonInput.value) + Number(button.dataset.seasonStep);
    if (year < 2022 || year > 2025) return;
    seasonInput.value = String(year);
    scene.querySelector<HTMLOutputElement>('[data-season-label]')!.value = String(year);
    scene.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((step) => {
      step.disabled = step.dataset.seasonStep === '-1' ? year <= 2022 : year >= 2025;
    });
    if (layerInputs.some((input) => input.checked && input.value !== 'satellite')) renderMapLayers();
    void updateView();
  }));
  dock.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((input) => input.addEventListener('change', () => { if (input.checked) { selectedMarker(); void updateView(); } }));
  plotInput.addEventListener('change', () => { selectedMarker(); void updateView(); });
  scene.querySelector<HTMLSelectElement>('select[name="metric"]')?.addEventListener('change', () => { void updateView(); });
  dock.addEventListener('submit', (event) => { event.preventDefault(); void updateView(); });

  const syncLanguageLinks = (url: URL) => {
    scene!.querySelectorAll<HTMLAnchorElement>('[data-lang-link]').forEach((link) => {
      const next = new URL(url);
      next.searchParams.set('lang', link.dataset.langLink ?? 'en');
      link.href = next.pathname + next.search;
    });
  };

  let pending: AbortController | undefined;
  async function updateView(overrides: Record<string, string> = {}) {
    const endpoint = scene!.dataset.endpoint;
    if (!endpoint) {
      status.textContent = `${selectedSpecies()} · ${seasonInput.value}`;
      return;
    }
    pending?.abort();
    pending = new AbortController();
    dock.setAttribute('aria-busy', 'true');
    status.textContent = copy.loading;
    const url = new URL(endpoint, location.href);
    new FormData(dock).forEach((value, name) => url.searchParams.set(name, String(value)));
    Object.entries(overrides).forEach(([name, value]) => url.searchParams.set(name, value));
    try {
      const response = await fetch(url, { signal: pending.signal, headers: { accept: 'text/html' } });
      if (!response.ok) throw Error('View unavailable');
      const next = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector<HTMLElement>('.hmi-page');
      if (!next) throw Error('View unavailable');
      for (const panel of ['thresholds', 'observations']) {
        const target = scene!.querySelector<HTMLElement>(`[data-response-panel="${panel}"]`);
        const source = next.querySelector<HTMLElement>(`[data-response-panel="${panel}"]`);
        if (target && source) target.innerHTML = source.innerHTML;
      }
      const nextPlots = next.querySelector<HTMLSelectElement>('select[name="plot"]');
      if (nextPlots) {
        plotInput.innerHTML = nextPlots.innerHTML;
        plotInput.disabled = nextPlots.disabled;
      }
      plotInput.value = next.dataset.plot ?? plotInput.value;
      url.searchParams.set('plot', plotInput.value);
      selectedMarker();
      history.pushState(null, '', url);
      syncLanguageLinks(url);
      status.textContent = `${selectedSpecies()} · ${seasonInput.value} ${copy.loaded}`;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        status.textContent = copy.updateFailed;
        showMessage(copy.panelFailed);
      }
    } finally { dock.removeAttribute('aria-busy'); }
  }

  // Area analysis (#131): draw a polygon, sample the heat pipeline for it; plot selection is locked while drawing.
  const drawButton = scene.querySelector<HTMLButtonElement>('[data-area-draw]');
  const runButton = scene.querySelector<HTMLButtonElement>('[data-area-run]');
  const clearButton = scene.querySelector<HTMLButtonElement>('[data-area-clear]');
  const areaHelp = scene.querySelector<HTMLElement>('[data-area-help]');
  const areaResult = scene.querySelector<HTMLElement>('[data-area-result]');
  const drawLayer = L.layerGroup().addTo(map);
  let coordinates: [number, number][] = [];
  let sketch: L.Polygon | undefined;

  const redrawSketch = () => {
    if (sketch) drawLayer.removeLayer(sketch);
    sketch = coordinates.length
      ? L.polygon(coordinates.map(([lng, lat]) => [lat, lng]), {
          color: '#9e4b34', weight: 3, dashArray: '6 4', fillColor: '#f5b84b', fillOpacity: 0.18,
        }).addTo(drawLayer)
      : undefined;
    if (runButton) runButton.disabled = coordinates.length < 3 || busy;
    if (clearButton) clearButton.disabled = coordinates.length === 0 && !drawing;
  };
  function setDrawing(next: boolean) {
    drawing = next;
    mapElement!.classList.toggle('drawing', next);
    if (drawButton) {
      drawButton.textContent = next ? copy.cancel : copy.draw;
      drawButton.setAttribute('aria-pressed', String(next));
    }
    redrawSketch();
  }
  drawButton?.addEventListener('click', () => {
    if (busy) return;
    if (!drawing) {
      coordinates = [];
      if (areaResult) areaResult.hidden = true;
    }
    setDrawing(!drawing);
  });
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (!drawing || busy) return;
    coordinates.push([event.latlng.lng, event.latlng.lat]);
    redrawSketch();
  });
  clearButton?.addEventListener('click', () => {
    if (busy) return;
    coordinates = [];
    setDrawing(false);
    if (areaHelp) areaHelp.textContent = `${copy.help} ${copy.extent}`;
    if (areaResult) {
      areaResult.hidden = true;
      areaResult.removeAttribute('data-error');
      areaResult.textContent = '';
    }
  });
  runButton?.addEventListener('click', async () => {
    if (coordinates.length < 3 || !areaResult || busy) return;
    busy = true;
    setDrawing(false);
    if (drawButton) drawButton.disabled = true;
    const ring = [...coordinates, coordinates[0]];
    areaResult.hidden = false;
    areaResult.removeAttribute('data-error');
    areaResult.textContent = copy.sampling;
    runButton.disabled = true;
    try {
      const response = await fetch('/api/risk/heat/area', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          feature: { type: 'Feature', properties: null, geometry: { type: 'Polygon', coordinates: [ring] } },
          start: seasonInput.value + '-06-01',
          end: seasonInput.value + '-10-31',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy.areaFailed);
      const values = (result.indices as { index: string; value: number | null }[])
        .filter((item) => item.index === 'SST' && item.value !== null)
        .map((item) => item.value as number);
      if (!values.length) {
        areaResult.textContent = copy.noData;
      } else {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        areaResult.textContent = lang === 'ja'
          ? `平均 ${mean.toFixed(1)}°C · 範囲 ${min.toFixed(1)}–${max.toFixed(1)}°C · 観測 ${values.length}日`
          : `Mean ${mean.toFixed(1)}°C · range ${min.toFixed(1)}–${max.toFixed(1)}°C · ${values.length} observed days`;
      }
    } catch (error) {
      areaResult.dataset.error = 'true';
      areaResult.textContent = lang === 'ja' ? copy.areaFailed : error instanceof Error ? error.message : copy.areaFailed;
    } finally {
      busy = false;
      if (drawButton) drawButton.disabled = false;
      redrawSketch();
    }
  });
}

}

initHmiMap();
