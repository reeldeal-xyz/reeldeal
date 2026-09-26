import { RULES, weatherForecast, type WeatherForecast } from '@repo/shared';
import { forecastChart, type ForecastMetric } from './forecast-chart';

const dateFormat = (lang: string, time: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { ...options, timeZone: 'Asia/Tokyo' }).format(new Date(time * 1000));
const numeric = (value: number | null, unit: string) => value === null ? '—' : `${value.toFixed(1)} ${unit}`;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
};

export async function parseForecastResponse(response: Response, signal: AbortSignal): Promise<WeatherForecast> {
  const limit = 128 * 1024;
  if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body
    || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Invalid forecast response');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Forecast response too large');
      text += decoder.decode(value, { stream: true });
    }
    return weatherForecast.parse(JSON.parse(text + decoder.decode()));
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export type ForecastFrame = { time: number; value: number | null; unit: string; label: string };

export function renderForecast(target: HTMLElement, forecast: WeatherForecast, lang: 'en' | 'ja', now = Date.now() / 1000,
  options: { species?: string; onFrame?: (frame: ForecastFrame | null) => void } = {}) {
  const ja = lang === 'ja';
  const hours = forecast.hours.filter((hour) => hour.time >= Math.floor(now / 3600) * 3600);
  let timer: ReturnType<typeof setInterval> | undefined;
  const play = element('button', ja ? '再生' : 'Play', 'forecast-play'); play.type = 'button'; play.setAttribute('aria-pressed', 'false');
  const pause = () => {
    clearInterval(timer); timer = undefined;
    play.textContent = ja ? '再生' : 'Play'; play.setAttribute('aria-pressed', 'false');
    document.removeEventListener('visibilitychange', pause);
  };
  const destroy = () => { pause(); options.onFrame?.(null); };
  if (!hours.length) {
    target.replaceChildren(element('p', ja ? '予報の有効期間が終了しました。更新してください。' : 'Forecast expired. Refresh to update.'));
    return { pause, destroy, showFrame: () => {} };
  }
  const body = document.createDocumentFragment();
  const controls = element('div', '', 'forecast-chart-controls');
  const metricLabel = element('label'); metricLabel.append(element('span', ja ? '予報項目' : 'Forecast metric', 'sr-only'));
  const select = element('select');
  const metrics = [
    { value: 'seaTemperatureC', label: ja ? '海面水温' : 'Sea temperature', unit: '°C' },
    { value: 'windSpeedMs', label: ja ? '風速' : 'Wind', unit: 'm/s' },
    { value: 'waveHeightM', label: ja ? '有義波高' : 'Significant waves', unit: 'm' },
    { value: 'airTemperatureC', label: ja ? '気温' : 'Air temperature', unit: '°C' },
    { value: 'precipitationMm', label: ja ? '降水量' : 'Precipitation', unit: 'mm' },
  ] satisfies { value: ForecastMetric; label: string; unit: string }[];
  for (const metric of metrics) { const option = element('option', metric.label); option.value = metric.value; select.append(option); }
  metricLabel.append(select);
  const unitLabel = element('label'), unitSelect = element('select'); unitLabel.append(element('span', ja ? '単位' : 'Unit', 'sr-only'));
  for (const unit of ['°C', '°F']) { const option = element('option', unit); option.value = unit; unitSelect.append(option); }
  unitLabel.append(unitSelect); controls.append(metricLabel, unitLabel); body.append(controls);
  const reading = element('div', '', 'forecast-reading');
  const valueLabel = element('strong'), timeLabel = element('time'); reading.append(valueLabel, timeLabel);
  const graph = element('div', '', 'forecast-graph');
  const playback = element('div', '', 'forecast-playback');
  const sliderLabel = element('label', '', 'forecast-hour-label');
  sliderLabel.append(element('span', ja ? '予報時刻 · JST' : 'Forecast hour · JST', 'sr-only'));
  const slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(hours.length - 1); slider.value = '0'; slider.step = '1';
  slider.disabled = hours.length < 2; play.disabled = hours.length < 2;
  sliderLabel.append(slider); playback.append(play, sliderLabel);
  const ends = element('div', '', 'forecast-time-ends');
  for (const hour of [hours[0], hours.at(-1)!]) ends.append(element('span', dateFormat(lang, hour.time, { month: 'short', day: 'numeric', hour: '2-digit' })));
  const reference = element('p', '', 'forecast-reference');
  body.append(reading, graph, playback, ends, reference);
  const svg = (name: string, attrs: Record<string, string | number>, text = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    node.textContent = text; return node;
  };
  let frame: ForecastFrame;
  const showFrame = () => { if (frame) options.onFrame?.(frame); };
  const draw = () => {
    const metric = metrics.find((item) => item.value === select.value)!;
    const fahrenheit = metric.unit === '°C' && unitSelect.value === '°F';
    const unit = fahrenheit ? '°F' : metric.unit;
    unitLabel.hidden = metric.unit !== '°C';
    const references = metric.value === 'seaTemperatureC'
      ? [...new Set(RULES.filter((rule) => rule.species === options.species && rule.peril === 'HEAT').map((rule) => rule.tempC!))]
        .map((temp) => fahrenheit ? temp * 9 / 5 + 32 : temp) : [];
    const chart = forecastChart(hours, metric.value, fahrenheit, references);
    const index = Number(slider.value), hour = hours[index];
    const value = chart?.readings[index].value ?? null;
    const time = dateFormat(lang, hour.time, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit' });
    valueLabel.textContent = numeric(value, unit); timeLabel.textContent = `${time} JST`; timeLabel.dateTime = new Date(hour.time * 1000).toISOString();
    slider.setAttribute('aria-valuetext', `${time} JST · ${numeric(value, unit)}`);
    frame = { time: hour.time, value, unit, label: metric.label }; showFrame();
    reference.textContent = references.length ? (ja ? '破線：補償の日ごとの水温基準' : 'Dashed: daily SST relief reference') : '';
    if (!chart) { graph.replaceChildren(element('p', ja ? 'この項目の予報はありません。' : 'No forecast for this metric.', 'shelf-note')); return; }
    const plot = svg('svg', { viewBox: '0 0 470 165', role: 'img', 'aria-label': `${metric.label} · ${chart.min.toFixed(1)}–${chart.max.toFixed(1)} ${unit}` });
    for (const tick of chart.ticks) {
      plot.append(svg('path', { d: `M44 ${tick.y}H456`, class: 'forecast-grid' }), svg('text', { x: 36, y: tick.y + 4, 'text-anchor': 'end' }, tick.value.toFixed(1)));
    }
    for (const threshold of references) {
      plot.append(svg('path', { d: `M44 ${chart.y(threshold)}H456`, class: 'forecast-threshold' }),
        svg('text', { x: 454, y: chart.y(threshold) - 5, 'text-anchor': 'end', class: 'forecast-threshold-label' }, `${threshold.toFixed(1)} ${unit}`));
    }
    for (const segment of chart.segments) plot.append(segment.length === 1
      ? svg('circle', { cx: segment[0].x, cy: segment[0].y, r: 3, class: 'forecast-line-point' })
      : svg('polyline', { points: segment.map((p) => `${p.x},${p.y}`).join(' '), class: 'forecast-line' }));
    plot.append(svg('path', { d: `M${chart.x(hour.time)} 20V148`, class: 'forecast-cursor' }));
    if (value !== null) plot.append(svg('circle', { cx: chart.x(hour.time), cy: chart.y(value), r: 5, class: 'forecast-line-point' }));
    graph.replaceChildren(plot);
  };
  select.addEventListener('change', draw); unitSelect.addEventListener('change', draw);
  slider.addEventListener('input', () => { pause(); draw(); });
  play.addEventListener('click', () => {
    if (timer !== undefined) { pause(); return; }
    if (Number(slider.value) >= hours.length - 1) { slider.value = '0'; draw(); }
    play.textContent = ja ? '停止' : 'Pause'; play.setAttribute('aria-pressed', 'true');
    document.addEventListener('visibilitychange', pause);
    timer = setInterval(() => {
      if (!target.isConnected) { destroy(); return; }
      slider.value = String(Math.min(Number(slider.value) + 1, hours.length - 1)); draw();
      if (Number(slider.value) === hours.length - 1) pause();
    }, 700);
  });
  const sources = element('details', '', 'forecast-sources');
  sources.append(element('summary', ja ? '予報の詳細' : 'Forecast details'));
  sources.append(element('p', `${ja ? '取得' : 'Updated'} ${dateFormat(lang, forecast.fetchedAt, { dateStyle: 'medium', timeStyle: 'short' })} JST`));
  for (const source of [forecast.weather, forecast.marine]) {
    const line = element('p'); const link = element('a', `${source.provider} · ${source.model}`); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(link);
    line.append(document.createTextNode(source.grid
      ? ` · ${source.grid.distanceKm} km ${ja ? '区画から' : 'from plot'}`
      : ` · ${ja ? '利用不可' : 'Unavailable'}`));
    sources.append(line);
  }
  sources.append(element('p', ja ? '海況モデルは沖合の格子予報です。港内の実測値ではありません。予報では補償を判定しません。' : 'Marine forecasts use offshore grid cells, not harbour measurements. Forecasts do not trigger relief payments.'));
  const warning = element('a', ja ? '気象庁の警報' : 'JMA warnings'); warning.href = 'https://www.jma.go.jp/bosai/warning/'; warning.target = '_blank'; warning.rel = 'noopener noreferrer'; sources.append(warning);
  body.append(sources); target.replaceChildren(body); draw();
  return { pause, destroy, showFrame };
}

export function initWeatherForecast(scene: HTMLElement, onFrame?: (frame: ForecastFrame | null) => void) {
  let playback: ReturnType<typeof renderForecast> | undefined;
  let pending: AbortController | undefined;
  let last: { panel: HTMLElement; fetchedAt: number } | undefined;
  async function load(force = false) {
    const panel = scene.querySelector<HTMLElement>('.weather-forecast');
    if (!panel || panel.dataset.weatherOperational !== 'true') return;
    const status = panel.querySelector<HTMLElement>('[data-weather-status]')!;
    const button = scene.querySelector<HTMLButtonElement>('[data-weather-refresh]')!;
    const target = panel.querySelector<HTMLElement>('[data-weather-content]')!;
    const lang = panel.dataset.weatherLang === 'ja' ? 'ja' : 'en', ja = lang === 'ja';
    if (!panel.dataset.weatherLocation) return;
    if (!force && last?.panel === panel && Date.now() / 1000 - last.fetchedAt < 900) return;
    pending?.abort(); const controller = new AbortController(); pending = controller;
    playback?.pause();
    button.disabled = true; panel.setAttribute('aria-busy', 'true');
    status.textContent = ja ? '気象・海況予報を取得中…' : 'Loading weather and marine forecasts…';
    try {
      const location = JSON.parse(panel.dataset.weatherLocation);
      const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude) });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
      const response = await fetch(`/api/weather/forecast?${params}`, { signal, cache: 'no-store', headers: { accept: 'application/json' }, redirect: 'error' });
      const result = await parseForecastResponse(response, signal);
      if (controller.signal.aborted || pending !== controller || !panel.isConnected) return;
      if (result.requested.latitude !== location.latitude || result.requested.longitude !== location.longitude || result.fetchedAt > Date.now() / 1000 + 60 || Date.now() / 1000 - result.fetchedAt > 10800) throw new Error('Forecast identity or age mismatch');
      if (!response.ok || result.status === 'unavailable') throw new Error('Forecast unavailable');
      status.textContent = result.status === 'stale' ? (ja ? '最新取得に失敗。以下は古い予報です。' : 'Refresh failed. Showing an explicitly stale forecast.')
        : result.status === 'partial' ? (ja ? '一部データが利用できません。欠測を表示しています。' : 'Partial forecast; missing fields remain unavailable.')
          : '';
      playback?.destroy();
      playback = renderForecast(target, result, lang, Date.now() / 1000, { species: scene.dataset.species, onFrame: (frame) => onFrame?.(scene.querySelector('#forecast-shelf[data-open]') ? frame : null) });
      last = result.status === 'stale' ? undefined : { panel, fetchedAt: result.fetchedAt };
    } catch {
      if (pending !== controller || controller.signal.aborted || !panel.isConnected) return;
      playback?.destroy(); playback = undefined; target.replaceChildren(); last = undefined;
      status.textContent = ja ? '予報サービスに接続できません。更新で再試行できます。' : 'Forecast service unavailable. Use Refresh to retry.';
    } finally {
      if (pending === controller) { button.disabled = false; panel.removeAttribute('aria-busy'); }
    }
  }
  scene.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-weather-refresh]')) void load(true);
  });
  return {
    open: () => { playback?.showFrame(); void load(); },
    close: () => { playback?.pause(); onFrame?.(null); },
    reset: () => { playback?.destroy(); playback = undefined; pending?.abort(); pending = undefined; last = undefined; if (scene.querySelector('#forecast-shelf[data-open]')) void load(); },
  };
}
