import L from 'leaflet';
import { hmiLayerDate } from './hmi-layer-date';

type Plot = { plotCode: string; centroid: [number, number]; geometry: GeoJSON.Geometry; species: string[]; source: string };
type Zone = { geometry: GeoJSON.Geometry | null; name: string; nameJa?: string | null };

export function initHmiMap(root: ParentNode = document) {
  const scene = root.querySelector<HTMLElement>('.hmi-page');
  const mapElement = scene?.querySelector<HTMLElement>('#hmi-map');
  if (!scene || !mapElement || scene.dataset.mapReady) return;

  scene.dataset.mapReady = 'true';
  const features = JSON.parse(scene.dataset.mapFeatures ?? '{"plots":[],"zones":[]}') as { plots: Plot[]; zones: Zone[] };
  const dock = scene.querySelector<HTMLFormElement>('.coast-dock')!;
  const status = scene.querySelector<HTMLElement>('[data-view-status]')!;
  const seasonInput = dock.elements.namedItem('season') as HTMLInputElement;
  const plotInput = dock.elements.namedItem('plot') as HTMLInputElement;
  const selectedSpecies = () => dock.querySelector<HTMLInputElement>('input[name="species"]:checked')?.value ?? '';

  const map = L.map(mapElement, {
    minZoom: 4,
    maxZoom: 16,
    zoomControl: false,
    scrollWheelZoom: true,
    touchZoom: true,
    dragging: true,
    bounceAtZoomLimits: false,
  }).setView([38.84, 141.61], 10);

  // Japan-wide navigation. Miyagi is the initial data focus, but touch/drag is not bounded to Miyagi.
  map.setMaxBounds([[20.0, 122.0], [46.5, 154.0]]);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, GIS User Community',
  }).addTo(map);

  const activeOverlays = new Map<string, L.TileLayer.WMS>();
  const layers: Record<string, { name: string; label: string }> = {
    sst: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature', label: 'Sea surface temperature' },
    anom: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', label: 'Temperature anomaly' },
    chl: { name: 'OCI_PACE_Chlorophyll_a', label: 'Chlorophyll' },
  };

  const layerNote = scene.querySelector<HTMLElement>('[data-layer-date]')!;
  const chlorophyllNote = scene.querySelector<HTMLElement>('[data-chlorophyll-note]')!;
  const mapMessage = scene.querySelector<HTMLElement>('[data-map-message]')!;
  const layerInputs = [...scene.querySelectorAll<HTMLInputElement>('input[name="map-layer"]')];
  const markerByCode = new Map<string, { marker: L.CircleMarker; plot: Plot }>();

  for (const zone of features.zones) {
    if (zone.geometry) {
      L.geoJSON(zone.geometry, {
        style: { color: '#f7f5df', weight: 1.5, fillColor: '#f7f5df', fillOpacity: 0.05 },
      }).addTo(map);
    }
  }

  for (const plot of features.plots) {
    const marker = L.circleMarker([plot.centroid[1], plot.centroid[0]], {
      radius: 4,
      weight: 1,
      color: '#fff',
      fillColor: '#f7a32f',
      fillOpacity: 1,
    });
    marker.bindTooltip(plot.plotCode);
    marker.on('click', () => {
      plotInput.value = plot.plotCode;
      const species = plot.species[0];
      const option = dock.querySelector<HTMLInputElement>(`input[name="species"][value="${species}"]`);
      if (option) option.checked = true;
      void updateView();
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
  }

  scene.querySelectorAll<HTMLButtonElement>('[data-shelf]').forEach((button) => button.addEventListener('click', () => {
    openShelf(button.getAttribute('aria-expanded') === 'true' ? null : button.dataset.shelf ?? null);
  }));
  scene.querySelectorAll<HTMLButtonElement>('[data-close-shelf]').forEach((button) => button.addEventListener('click', () => openShelf(null)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') openShelf(null); });

  function renderMapLayers() {
    mapMessage.hidden = true;

    const satellite = layerInputs.find((input) => input.value === 'satellite')?.checked ?? false;
    if (satellite && !map.hasLayer(imagery)) imagery.addTo(map);
    if (!satellite && map.hasLayer(imagery)) map.removeLayer(imagery);

    activeOverlays.forEach((overlay) => map.removeLayer(overlay));
    activeOverlays.clear();

    const selected = layerInputs.filter((input) => input.checked && input.value !== 'satellite');
    const time = hmiLayerDate(seasonInput.value);

    selected.forEach((input) => {
      const layer = layers[input.value];
      if (!layer) return;
      const overlay = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: layer.name,
        format: 'image/png',
        transparent: true,
        opacity: selected.length > 1 ? 0.34 : 0.72,
        version: '1.1.1',
        time,
        attribution: '&copy; NASA GIBS',
      } as L.WMSOptions);

      let errors = 0;
      overlay.on('tileerror', () => {
        if (activeOverlays.get(input.value) !== overlay) return;
        errors += 1;
        if (errors < 2) return;
        mapMessage.textContent = `${layer.label} imagery is unavailable for ${time}. The base map remains usable.`;
        mapMessage.hidden = false;
      });
      overlay.on('tileload', () => {
        if (activeOverlays.get(input.value) === overlay && errors === 0) mapMessage.hidden = true;
      });
      activeOverlays.set(input.value, overlay.addTo(map));
    });

    layerNote.textContent = selected.length
      ? `NASA GIBS · ${time}`
      : satellite
        ? 'Satellite · Esri'
        : 'Map · OpenStreetMap';
    chlorophyllNote.hidden = !selected.some((input) => input.value === 'chl');
  }

  layerInputs.forEach((input) => input.addEventListener('change', renderMapLayers));

  scene.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.zoom === 'in') map.zoomIn();
    else map.zoomOut();
  }));

  scene.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((button) => button.addEventListener('click', () => {
    const year = Number(seasonInput.value) + Number(button.dataset.seasonStep);
    if (year < 2022 || year > 2026) return;
    seasonInput.value = String(year);
    scene.querySelector<HTMLOutputElement>('[data-season-label]')!.value = String(year);
    scene.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((step) => {
      step.disabled = step.dataset.seasonStep === '-1' ? year <= 2022 : year >= 2026;
    });
    if (layerInputs.some((input) => input.checked && input.value !== 'satellite')) renderMapLayers();
    void updateView();
  }));

  dock.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) {
      selectedMarker();
      void updateView();
    }
  }));
  dock.addEventListener('submit', (event) => {
    event.preventDefault();
    void updateView();
  });

  let pending: AbortController | undefined;

  async function updateView() {
    const endpoint = scene!.dataset.endpoint;
    if (!endpoint) {
      status.textContent = `${selectedSpecies()} · ${seasonInput.value}`;
      return;
    }

    pending?.abort();
    pending = new AbortController();
    dock.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading observations…';

    const url = new URL(endpoint, location.href);
    new FormData(dock).forEach((value, name) => url.searchParams.set(name, String(value)));

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

      plotInput.value = next.dataset.plot ?? plotInput.value;
      url.searchParams.set('plot', plotInput.value);
      selectedMarker();
      history.pushState(null, '', url);
      status.textContent = `${selectedSpecies()} · ${seasonInput.value} loaded`;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        status.textContent = 'Could not update observations. Try again.';
        mapMessage.textContent = 'Observations could not be updated.';
        mapMessage.hidden = false;
      }
    } finally {
      dock.removeAttribute('aria-busy');
    }
  }
}

initHmiMap();
