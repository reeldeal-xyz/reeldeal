import L from 'leaflet';
import { hmiLayerDate } from './hmi-layer-date';
import { readPlotObservations } from './plot-observations';
import { operationColor, plotFacts, type PlotLabels } from './plot-layer';

type Plot = {
  plotCode: string; centroid: [number, number]; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; species: string[]; source: string;
  operation: string; areaM2: number; seaArea: string | null;
};
type Zone = { geometry: GeoJSON.Geometry | null; name: string; nameJa?: string | null };
type HabSource = {
  url: string; bounds: L.LatLngBoundsLiteral; note: string; period: string;
  scale: { kind: 'linear' | 'log'; min: number; max: number; unit: string; colors: string[] } | null;
};

const ENGLISH: Record<string, string> = {
  draw: 'Draw area', cancel: 'Finish drawing', help: 'Click the map to add 3 or more points, then analyze.',
  extent: 'Area limited to the mapped Miyagi coast.', sampling: 'Sampling satellite temperature data…',
  noData: 'No valid temperature data.', areaFailed: 'Area analysis unavailable.',
  tilesFailed: 'Map tiles failed to load. Plot and observation data remain available.',
  loading: 'Loading observations…', loaded: 'loaded', updateFailed: 'Could not update observations. Try again.',
  panelFailed: 'Observations could not be updated.', outlines: 'Map · OpenStreetMap', satelliteNote: 'Satellite · Esri',
  overlayUnavailable: '{layer} imagery is unavailable for {time}.', sst: 'Sea temperature', anom: 'Temp anomaly',
  habLog: '(log)', plotSelect: 'Click to select this plot', plotHeatLoading: 'Sampling sea temperature…',
  plotHeat: 'Sea temp {season}: mean {mean}°C · max {max}°C · {days} days', plotHeatNone: 'No sea temperature data for {season}',
  plotHeatUnavailable: 'Observation service unavailable for {season}.', plotHeatInvalid: 'Plot observation response failed validation.',
};

const SEASON_MIN = 2022;
const SEASON_MAX = new Date().getUTCFullYear();

export function initHmiMap(root: ParentNode = document) {
const scene = root.querySelector<HTMLElement>('.hmi-page');
const mapElement = scene?.querySelector<HTMLElement>('#hmi-map');
if (scene && mapElement && !scene.dataset.mapReady) {
  scene.dataset.mapReady = 'true';
  const copy = { ...ENGLISH, ...JSON.parse(scene.dataset.copy ?? '{}') as Record<string, string> };
  const plotLabels = JSON.parse(scene.dataset.plotLabels ?? 'null') as PlotLabels | null ?? {
    sources: {}, operations: {}, species: {}, noSpecies: 'No species recorded', noSeaArea: 'Outside mapped sea areas',
    hectares: 'ha', locale: 'en-US',
  };
  const lang = scene.dataset.lang === 'ja' ? 'ja' : 'en';
  const features = JSON.parse(scene.dataset.mapFeatures ?? '{"plots":[],"zones":[]}') as { plots: Plot[]; zones: Zone[] };
  const dock = scene.querySelector<HTMLFormElement>('.coast-dock')!;
  const status = scene.querySelector<HTMLElement>('[data-view-status]')!;
  const seasonInput = dock.elements.namedItem('season') as HTMLInputElement;
  const plotInput = scene.querySelector<HTMLSelectElement>('select[name="plot"]')!;
  const metricInput = scene.querySelector<HTMLSelectElement>('select[name="metric"]');
  const habMonthInput = scene.querySelector<HTMLSelectElement>('select[name="habMonth"]');
  const selectedSpecies = () => (dock.querySelector<HTMLInputElement>('input[name="species"]:checked')?.value ?? '');
  // Localised name of the checked species (the label text), for status announcements.
  const selectedSpeciesName = () => dock.querySelector<HTMLInputElement>('input[name="species"]:checked')
    ?.closest('label')?.querySelector(':scope > span > span')?.textContent?.trim() ?? selectedSpecies();
  // Pinch, drag and wheel/trackpad zoom across Japan (#148); Miyagi stays the initial data focus.
  const map = L.map(mapElement, {
    minZoom: 4, maxZoom: 16, zoomControl: false, attributionControl: false,
    scrollWheelZoom: true, touchZoom: true, dragging: true, bounceAtZoomLimits: false,
  }).setView([38.84, 141.61], 10);
  // Bottom-left and lifted above the dock (hmi.css), so attribution is never covered by the dock or the observations toggle.
  L.control.attribution({ position: 'bottomleft' }).addTo(map);
  map.setMaxBounds([[20.0, 122.0], [46.5, 154.0]]);
  // Only the selected basemap is loaded; hidden tile failures must not obscure the visible map.
  const basemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    zIndex: 100, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, zIndex: 100,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, GIS User Community',
  }).addTo(map);
  const activeOverlays = new Map<string, L.TileLayer>();
  const layers: Record<string, { name: string; label: string }> = {
    sst: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature', label: copy.sst },
    anom: { name: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', label: copy.anom },
  };
  const layerNote = scene.querySelector<HTMLElement>('[data-layer-date]')!;
  const mapMessage = scene.querySelector<HTMLElement>('[data-map-message]')!;
  const mapMessageText = scene.querySelector<HTMLElement>('[data-map-message-text]')!;
  const retryButton = scene.querySelector<HTMLButtonElement>('[data-map-retry]')!;
  const layerInputs = [...scene.querySelectorAll<HTMLInputElement>('input[name="map-layer"]')];
  const habInput = layerInputs.find((input) => input.value === 'hab');
  const plotsInput = layerInputs.find((input) => input.value === 'plots');
  const markerByCode = new Map<string, { marker: L.CircleMarker; plot: Plot }>();
  let drawing = false;
  let busy = false;

  // Transient messages (tile failures, update failures) only; the pipeline status has its own element.
  let messageOwner: L.TileLayer | 'update' | null = null;
  const showMessage = (text: string, owner: L.TileLayer | 'update', retry = false) => {
    messageOwner = owner;
    mapMessageText.textContent = text;
    retryButton.hidden = !retry;
    mapMessage.hidden = false;
  };
  const hideMessage = (owner?: L.TileLayer | 'update') => {
    if (owner && owner !== messageOwner) return;
    messageOwner = null;
    mapMessage.hidden = true;
  };

  // Tile failures, counted per layer: a layer that fails twice shows Retry; it clears when that layer loads again.
  const failures = new WeakMap<L.TileLayer, number>();
  const watchTiles = (layer: L.TileLayer, failure: () => string) => layer
    .on('loading', () => { failures.set(layer, 0); })
    .on('load', () => { if ((failures.get(layer) ?? 0) === 0) hideMessage(layer); })
    .on('tileerror', () => {
      if (!map.hasLayer(layer)) return;
      const count = (failures.get(layer) ?? 0) + 1;
      failures.set(layer, count);
      if (count >= 2) showMessage(failure(), layer, true);
    });
  watchTiles(basemap, () => copy.tilesFailed);
  watchTiles(imagery, () => copy.tilesFailed);
  retryButton.addEventListener('click', () => {
    hideMessage();
    if (map.hasLayer(basemap)) basemap.redraw();
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
  // Every plot as a polygon, coloured by operation; hover shows its facts, then the season's sea temperature.
  const plotStyle = (plot: Plot, hover = false): L.PathOptions => {
    const selected = plot.plotCode === plotInput.value;
    return {
      color: selected || hover ? '#ffffff' : operationColor(plot.operation), weight: selected || hover ? 2.5 : 1,
      fillColor: operationColor(plot.operation), fillOpacity: hover ? 0.6 : selected ? 0.45 : 0.28,
    };
  };
  const plotLayers = new Map<string, { layer: L.GeoJSON; plot: Plot }>();
  const plotGroup = L.layerGroup();
  const heatCache = new Map<string, { promise: Promise<string | null>; expiresAt: number }>();
  let heatRequest: { key: string; controller: AbortController } | undefined;
  const plotHeat = (plot: Plot): Promise<string | null> => {
    const season = seasonInput.value;
    const key = `${plot.plotCode}|${season}`;
    const cached = heatCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    heatCache.delete(key);
    if (!scene.dataset.endpoint) return Promise.resolve(null);
    if (heatRequest) { heatRequest.controller.abort(); heatCache.delete(heatRequest.key); }
    const controller = new AbortController();
    heatRequest = { key, controller };
    let request: Promise<string | null>;
    request = readPlotObservations(plot.plotCode, season, controller.signal).then((result) => {
      if (result.status !== 'available') {
        if (heatCache.get(key)?.promise === request) heatCache.delete(key);
        if (result.status === 'cancelled') return null;
        return (result.status === 'not-found' || result.status === 'no-observations' ? copy.plotHeatNone
          : result.status === 'invalid-payload' ? copy.plotHeatInvalid : copy.plotHeatUnavailable).replace('{season}', season);
      }
      const { summary } = result;
      return copy.plotHeat.replace('{season}', season).replace('{mean}', summary.mean.toFixed(1))
        .replace('{max}', summary.max.toFixed(1)).replace('{days}', String(summary.count))
        + ` · ${result.coverage.observedDays}/${result.coverage.expectedDays} · ${summary.latest.asOf}`
        + (result.stale ? (lang === 'ja' ? ' · 古いデータ' : ' · stale') : '');
    }).finally(() => { if (heatRequest?.controller === controller) heatRequest = undefined; });
    if (heatCache.size >= 100) heatCache.delete(heatCache.keys().next().value!);
    heatCache.set(key, { promise: request, expiresAt: Date.now() + 60_000 });
    return request;
  };
  const tooltipFor = (plot: Plot) => {
    const box = document.createElement('div');
    box.className = 'plot-tip';
    const title = box.appendChild(document.createElement('strong'));
    title.textContent = plot.plotCode;
    for (const line of plotFacts(plot, plotLabels)) box.appendChild(document.createElement('span')).textContent = line;
    const heat = box.appendChild(document.createElement('span'));
    heat.className = 'plot-tip-heat';
    heat.hidden = !scene.dataset.endpoint;
    heat.textContent = copy.plotHeatLoading;
    box.appendChild(document.createElement('em')).textContent = copy.plotSelect;
    return { box, heat };
  };
  let hoverTimer: number | undefined;
  for (const plot of features.plots) {
    const layer = L.geoJSON(plot.geometry, { style: () => plotStyle(plot) });
    const tip = tooltipFor(plot);
    let hovered = false;
    layer.bindTooltip(tip.box, { sticky: true, direction: 'top', offset: [0, -8], className: 'plot-tooltip' });
    layer.on('mouseover', () => {
      if (drawing) return;
      hovered = true;
      layer.setStyle(plotStyle(plot, true));
      layer.bringToFront();
      window.clearTimeout(hoverTimer);
      if (!scene.dataset.endpoint) return;
      const hoverSeason = seasonInput.value;
      const show = () => { void plotHeat(plot).then((text) => { if (text && hovered && seasonInput.value === hoverSeason) tip.heat.textContent = text; }); };
      if (heatCache.has(`${plot.plotCode}|${seasonInput.value}`)) { show(); return; }
      tip.heat.textContent = copy.plotHeatLoading;
      // Debounced, so sweeping the pointer across the coast doesn't sample every plot on the way.
      hoverTimer = window.setTimeout(show, 250);
    });
    layer.on('mouseout', () => { hovered = false; window.clearTimeout(hoverTimer); layer.setStyle(plotStyle(plot)); });
    layer.on('click', () => {
      if (drawing || busy) return;
      if (!plot.species.includes(selectedSpecies())) {
        const option = dock.querySelector<HTMLInputElement>(`input[name="species"][value="${CSS.escape(plot.species[0])}"]`);
        if (option) option.checked = true;
      }
      void updateView({ plot: plot.plotCode, species: plot.species.includes(selectedSpecies()) ? selectedSpecies() : plot.species[0] ?? '' });
    });
    plotGroup.addLayer(layer);
    plotLayers.set(plot.plotCode, { layer, plot });
  }
  const restylePlots = () => plotLayers.forEach(({ layer, plot }) => layer.setStyle(plotStyle(plot)));
  const renderPlots = () => {
    const on = plotsInput?.checked ?? true;
    if (on && !map.hasLayer(plotGroup)) plotGroup.addTo(map);
    if (!on && map.hasLayer(plotGroup)) map.removeLayer(plotGroup);
  };
  renderPlots();
  plotsInput?.addEventListener('change', renderPlots);
  const points = features.plots.map((plot) => [plot.centroid[1], plot.centroid[0]] as [number, number]);
  const initialPlot = markerByCode.get(plotInput.value)?.plot;
  if (initialPlot) map.fitBounds(L.geoJSON(initialPlot.geometry).getBounds(), { padding: [70, 70], maxZoom: 12 });
  else if (points.length) map.fitBounds(points, { padding: [70, 70], maxZoom: 12 });
  const selectedMarker = () => {
    markerByCode.forEach(({ marker }, code) => {
      const visible = code === plotInput.value;
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
      marker.setStyle({ radius: code === plotInput.value ? 7 : 4, weight: code === plotInput.value ? 2 : 1 });
    });
    restylePlots();
  };
  // Bring a newly selected plot into view without changing the zoom.
  const showSelectedPlot = () => {
    const selected = markerByCode.get(plotInput.value);
    if (selected && !map.getBounds().pad(-0.1).contains(selected.marker.getLatLng())) map.panTo(selected.marker.getLatLng());
  };
  selectedMarker();

  // Attribution stays readable: lift it above an open bottom panel that would otherwise cover it.
  const attributionCorner = mapElement.querySelector<HTMLElement>('.leaflet-bottom.leaflet-left');
  const placeAttribution = () => {
    if (!attributionCorner) return;
    attributionCorner.style.bottom = '';
    const shelf = scene!.querySelector<HTMLElement>('.bottom-shelf[data-open]');
    if (!shelf) return;
    const corner = attributionCorner.getBoundingClientRect();
    const panel = shelf.getBoundingClientRect();
    if (panel.left >= corner.right || panel.right <= corner.left) return;
    const panelTop = parseFloat(getComputedStyle(shelf).bottom) + shelf.offsetHeight;
    attributionCorner.style.bottom = `${Math.ceil(panelTop + 6)}px`;
  };
  window.addEventListener('resize', placeAttribution);

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
    placeAttribution();
  }
  scene.querySelectorAll<HTMLButtonElement>('[data-shelf]').forEach((button) => button.addEventListener('click', () => {
    openShelf(button.getAttribute('aria-expanded') === 'true' ? null : button.dataset.shelf ?? null);
  }));
  scene.querySelectorAll<HTMLButtonElement>('[data-close-shelf]').forEach((button) => button.addEventListener('click', () => openShelf(null)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') openShelf(null); });

  // HAB legend chip over the map: ramp, range and the "not toxin status" caveat stay visible while the layer is on.
  const habChip = scene.querySelector<HTMLElement>('[data-hab-chip]');
  const renderHabChip = (source: HabSource | null) => {
    if (!habChip) return;
    habChip.hidden = !source?.scale;
    if (!source?.scale) return;
    const { scale } = source;
    habChip.querySelector<HTMLElement>('[data-hab-chip-period]')!.textContent = source.period;
    habChip.querySelector<HTMLElement>('[data-hab-chip-ramp]')!.style.background = `linear-gradient(90deg, ${scale.colors.join(', ')})`;
    habChip.querySelector<HTMLElement>('[data-hab-chip-min]')!.textContent = `≤${scale.min}`;
    habChip.querySelector<HTMLElement>('[data-hab-chip-max]')!.textContent = `≥${scale.max} ${scale.unit}${scale.kind === 'log' ? ` ${copy.habLog}` : ''}`;
  };

  const habSourceRaw = () => scene!.querySelector<HTMLElement>('[data-hab-source]')?.dataset.overlay ?? '';
  const habOverlay = (): HabSource | null => {
    const raw = habSourceRaw();
    return raw ? JSON.parse(raw) as HabSource : null;
  };
  let rendered = { hab: '', season: '', habOn: false };
  function renderMapLayers() {
    const satellite = layerInputs.find((input) => input.value === 'satellite')?.checked ?? false;
    if (satellite && map.hasLayer(basemap)) { map.removeLayer(basemap); hideMessage(basemap); }
    if (!satellite && !map.hasLayer(basemap)) basemap.addTo(map);
    if (satellite && !map.hasLayer(imagery)) imagery.addTo(map);
    if (!satellite && map.hasLayer(imagery)) { map.removeLayer(imagery); hideMessage(imagery); }
    activeOverlays.forEach((overlay) => { map.removeLayer(overlay); hideMessage(overlay); });
    activeOverlays.clear();
    const selected = layerInputs.filter((input) => input.checked && input.value !== 'satellite' && input.value !== 'plots');
    // Current season: a date safely inside NASA's near-real-time lag; past seasons: the season's end (#148).
    const time = hmiLayerDate(seasonInput.value);
    const notes: string[] = [];
    const habSource = habOverlay();
    const habLegend = scene!.querySelector<HTMLElement>('[data-hab-legend]');
    const habOn = selected.some((input) => input.value === 'hab') && !!habSource;
    if (habLegend) habLegend.hidden = !habOn;
    renderHabChip(habOn ? habSource : null);
    if (habOn && habSource) {
      // The pipeline's JAXA SGLI chl-a tiles, bounded to the layer grid so nothing is requested outside it.
      const overlay = L.tileLayer(habSource.url, {
        bounds: habSource.bounds, maxNativeZoom: 12, maxZoom: 16,
        opacity: selected.length > 1 ? 0.6 : 0.85, attribution: 'JAXA GCOM-C SGLI',
      });
      watchTiles(overlay, () => copy.tilesFailed);
      activeOverlays.set('hab', overlay.addTo(map));
      notes.push(habSource.note);
    }
    if (selected.some((input) => layers[input.value])) notes.unshift(`NASA GIBS · ${time}`);
    selected.forEach((input) => {
      const layer = layers[input.value];
      if (!layer) return;
      const overlay = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
        layers: layer.name, format: 'image/png', transparent: true,
        opacity: selected.length > 1 ? 0.34 : 0.72, version: '1.1.1', time,
        attribution: '&copy; NASA GIBS',
      } as L.WMSOptions);
      watchTiles(overlay, () => copy.overlayUnavailable.replace('{layer}', layer.label).replace('{time}', time));
      activeOverlays.set(input.value, overlay.addTo(map));
    });
    layerNote.textContent = notes.length ? notes.join(' / ') : satellite ? copy.satelliteNote : copy.outlines;
    rendered = { hab: habSourceRaw(), season: seasonInput.value, habOn };
  }
  // After an in-place update the HAB panel is swapped: follow whether a layer exists, restore the user's
  // choice when it does, and redraw only when the HAB source, its state or the season (GIBS time) changed.
  function syncHab() {
    if (habInput) {
      const available = !!habSourceRaw();
      habInput.disabled = !available;
      habInput.checked = available && habInput.dataset.wanted === 'true';
    }
    const habOn = !!habInput?.checked && !!habSourceRaw();
    if (habSourceRaw() !== rendered.hab || seasonInput.value !== rendered.season || habOn !== rendered.habOn) renderMapLayers();
  }
  layerInputs.filter((input) => input !== plotsInput).forEach((input) => input.addEventListener('change', () => {
    if (input === habInput) input.dataset.wanted = String(input.checked);
    renderMapLayers();
  }));
  habMonthInput?.addEventListener('change', () => { void updateView(); });
  scene.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.zoom === 'in') map.zoomIn(); else map.zoomOut();
  }));

  const setSeason = (year: number) => {
    const clamped = Math.min(SEASON_MAX, Math.max(SEASON_MIN, year));
    if (String(clamped) !== seasonInput.value) clearAreaResult();
    seasonInput.value = String(clamped);
    scene!.querySelector<HTMLOutputElement>('[data-season-label]')!.value = String(clamped);
    scene!.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((step) => {
      step.disabled = step.dataset.seasonStep === '-1' ? clamped <= SEASON_MIN : clamped >= SEASON_MAX;
    });
  };
  scene.querySelectorAll<HTMLButtonElement>('[data-season-step]').forEach((button) => button.addEventListener('click', () => {
    setSeason(Number(seasonInput.value) + Number(button.dataset.seasonStep));
    // With a server, layers are redrawn once the new season's panels arrive (syncHab); offline (Storybook) redraw now.
    if (!scene.dataset.endpoint) renderMapLayers();
    void updateView();
  }));
  dock.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((input) => input.addEventListener('change', () => { if (input.checked) { selectedMarker(); void updateView(); } }));
  plotInput.addEventListener('change', () => {
    const selected = markerByCode.get(plotInput.value)?.plot;
    void updateView({ species: selected?.species.includes(selectedSpecies()) ? selectedSpecies() : selected?.species[0] ?? '' });
  });
  metricInput?.addEventListener('change', () => { void updateView(); });
  dock.addEventListener('submit', (event) => { event.preventDefault(); void updateView(); });

  const syncLanguageLinks = (url: URL) => {
    scene!.querySelectorAll<HTMLAnchorElement>('[data-lang-link]').forEach((link) => {
      const next = new URL(url);
      next.searchParams.set('lang', link.dataset.langLink ?? 'en');
      link.href = next.pathname + next.search;
    });
  };

  // The controls as of the last view the server confirmed; restored when an update fails or on Back/Forward.
  type ViewState = { species: string; season: string; metric: string; habMonth: string; plot: string };
  const readControls = (): ViewState => ({
    species: selectedSpecies(), season: seasonInput.value, metric: metricInput?.value ?? 'SST',
    habMonth: habMonthInput?.value ?? '08', plot: plotInput.value,
  });
  const applyControls = (state: Partial<ViewState>) => {
    if (state.species !== undefined) {
      dock.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((option) => {
        option.checked = option.value === state.species && !option.disabled;
      });
    }
    if (state.season && /^\d{4}$/.test(state.season)) setSeason(Number(state.season));
    if (state.metric && metricInput && [...metricInput.options].some((o) => o.value === state.metric)) metricInput.value = state.metric;
    if (state.habMonth && habMonthInput && [...habMonthInput.options].some((o) => o.value === state.habMonth)) habMonthInput.value = state.habMonth;
    if (state.plot && [...plotInput.options].some((o) => o.value === state.plot)) plotInput.value = state.plot;
    selectedMarker();
  };
  let confirmed = readControls();
  // What the page showed on load: the view for any parameter a history entry's URL leaves out.
  const initial = confirmed;

  let pending: AbortController | undefined;
  async function updateView(overrides: Record<string, string> = {}, push = true) {
    const endpoint = scene!.dataset.endpoint;
    if (!endpoint) {
      status.textContent = `${selectedSpeciesName()} · ${seasonInput.value}`;
      return;
    }
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    dock.setAttribute('aria-busy', 'true');
    status.textContent = copy.loading;
    const url = new URL(endpoint, location.href);
    new FormData(dock).forEach((value, name) => url.searchParams.set(name, String(value)));
    Object.entries(overrides).forEach(([name, value]) => url.searchParams.set(name, value));
    try {
      const response = await fetch(url, { signal, headers: { accept: 'text/html' } });
      if (!response.ok) throw Error('View unavailable');
      const next = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector<HTMLElement>('.hmi-page');
      signal.throwIfAborted();
      if (pending !== controller) return;
      if (!next) throw Error('View unavailable');
      for (const panel of ['thresholds', 'observations', 'hab']) {
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
      scene!.dataset.plot = plotInput.value;
      scene!.dataset.species = next.dataset.species ?? '';
      scene!.dataset.season = next.dataset.season ?? seasonInput.value;
      applyControls({ species: scene!.dataset.species, season: scene!.dataset.season });
      url.searchParams.set('plot', plotInput.value);
      url.searchParams.set('species', scene!.dataset.species);
      syncHab();
      selectedMarker();
      showSelectedPlot();
      placeAttribution();
      if (push) history.pushState(null, '', url);
      syncLanguageLinks(url);
      hideMessage('update');
      confirmed = readControls();
      status.textContent = `${selectedSpeciesName()} · ${seasonInput.value} ${copy.loaded}`;
    } catch (error) {
      if (pending === controller && !controller.signal.aborted) {
        // Put the controls back to what the panels and map still show.
        applyControls(confirmed);
        syncHab();
        status.textContent = copy.updateFailed;
        showMessage(copy.panelFailed, 'update');
      }
    } finally { if (pending === controller) dock.removeAttribute('aria-busy'); }
  }
  // Back/Forward: re-apply the URL's view without adding another history entry.
  if (scene.dataset.endpoint) {
    window.addEventListener('popstate', () => {
      const params = new URL(location.href).searchParams;
      const state: ViewState = { ...initial };
      for (const key of ['species', 'season', 'metric', 'habMonth', 'plot'] as const) {
        const value = params.get(key);
        if (value !== null) state[key] = value;
      }
      applyControls(state);
      void updateView({ ...state }, false);
    });
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

  function clearAreaResult() {
    if (!areaResult) return;
    areaResult.hidden = true;
    areaResult.removeAttribute('data-error');
    areaResult.textContent = '';
  }
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
      clearAreaResult();
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
    clearAreaResult();
  });
  runButton?.addEventListener('click', async () => {
    if (coordinates.length < 3 || !areaResult || busy) return;
    busy = true;
    setDrawing(false);
    if (drawButton) drawButton.disabled = true;
    const ring = [...coordinates, coordinates[0]];
    const season = seasonInput.value;
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
          start: season + '-06-01',
          end: season + '-10-31',
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
          ? `${season}年 · 平均 ${mean.toFixed(1)}°C · 範囲 ${min.toFixed(1)}–${max.toFixed(1)}°C · 観測 ${values.length}日`
          : `${season} · mean ${mean.toFixed(1)}°C · range ${min.toFixed(1)}–${max.toFixed(1)}°C · ${values.length} observed days`;
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
