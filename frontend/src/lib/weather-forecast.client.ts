import { weatherForecast, type WeatherForecast, type WeatherForecastPoint } from '@repo/shared';

const dateFormat = (lang: string, time: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { ...options, timeZone: 'Asia/Tokyo' }).format(new Date(time * 1000));
const numeric = (value: number | null, unit: string) => value === null ? '—' : `${value.toFixed(1)} ${unit}`;
const values = (hours: WeatherForecastPoint[], key: keyof WeatherForecastPoint) => hours.map((hour) => hour[key]).filter((value): value is number => typeof value === 'number');
const range = (hours: WeatherForecastPoint[], key: keyof WeatherForecastPoint) => {
  const data = values(hours, key);
  return data.length ? `${Math.min(...data).toFixed(1)}–${Math.max(...data).toFixed(1)} °C${data.length < hours.length ? '*' : ''}` : '—';
};
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

export function renderForecast(target: HTMLElement, forecast: WeatherForecast, lang: 'en' | 'ja', now = Date.now() / 1000) {
  const ja = lang === 'ja';
  const hours = forecast.hours.filter((hour) => hour.time >= Math.floor(now / 3600) * 3600);
  const body = document.createDocumentFragment();
  if (!hours.length) { target.replaceChildren(element('p', ja ? '予報の有効期間が終了しました。更新してください。' : 'This forecast has expired. Refresh to request new data.')); return; }
  body.append(element('p', `${ja ? '取得' : 'Retrieved'} ${dateFormat(lang, forecast.fetchedAt, { dateStyle: 'medium', timeStyle: 'short' })} JST`, 'shelf-note'));
  body.append(element('p', `${dateFormat(lang, hours[0].time, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} → ${dateFormat(lang, hours.at(-1)!.time, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} JST`, 'shelf-note'));
  const groups = new Map<string, WeatherForecastPoint[]>();
  for (const hour of hours) {
    const day = new Date((hour.time + 32400) * 1000).toISOString().slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), hour]);
  }
  const cards = element('div', '', 'forecast-days');
  for (const group of groups.values()) {
    const card = element('section', '', 'forecast-day');
    card.append(element('h3', dateFormat(lang, group[0].time, { weekday: 'short', month: 'short', day: 'numeric' })));
    card.append(element('p', `${dateFormat(lang, group[0].time, { hour: '2-digit', minute: '2-digit' })}–${dateFormat(lang, group.at(-1)!.time, { hour: '2-digit', minute: '2-digit' })} · ${group.length}${ja ? '時間' : ' hours'}`));
    const list = element('dl');
    const wind = values(group, 'windSpeedMs'), rain = values(group, 'precipitationMm'), waves = values(group, 'waveHeightM');
    const fields = [
      [ja ? '気温' : 'Air temperature', range(group, 'airTemperatureC')],
      [ja ? '最大風速' : 'Max wind', numeric(wind.length ? Math.max(...wind) : null, 'm/s') + (wind.length && wind.length < group.length ? '*' : '')],
      [ja ? '表示時間内の降水量' : 'Precipitation in shown hours', numeric(rain.length === group.length ? rain.reduce((a, b) => a + b, 0) : null, 'mm')],
      [ja ? '海面水温（予報）' : 'Sea temperature', range(group, 'seaTemperatureC')],
      [ja ? '最大有義波高' : 'Max significant wave', numeric(waves.length ? Math.max(...waves) : null, 'm') + (waves.length && waves.length < group.length ? '*' : '')],
    ];
    for (const [label, value] of fields) { const row = element('div'); row.append(element('dt', String(label)), element('dd', String(value))); list.append(row); }
    card.append(list); cards.append(card);
  }
  body.append(cards, element('p', ja ? '— = 欠測。* = 利用可能な時間だけの集計。' : '— = missing. * = summary of available hours only.', 'shelf-note'));
  const details = element('details', '', 'forecast-hourly'); details.append(element('summary', ja ? '6時間ごとの予報' : 'Forecast at 6-hour intervals'));
  const wrap = element('div', '', 'forecast-table'); wrap.tabIndex = 0;
  const table = element('table'); table.append(element('caption', ja ? '時刻はJST。降水量は各時刻の直前1時間の予報値。' : 'Times are JST. Precipitation is forecast for the hour ending at each timestamp.'));
  const headings = element('tr');
  for (const label of [ja ? '時刻' : 'Time', ja ? '気温 °C' : 'Air °C', ja ? '風 m/s' : 'Wind m/s', ja ? '降水 mm' : 'Precip. mm', ja ? '水温 °C' : 'Sea °C', ja ? '波高 m' : 'Wave m']) { const th = element('th', label); th.scope = 'col'; headings.append(th); }
  const head = element('thead'); head.append(headings); table.append(head); const tbody = element('tbody');
  hours.filter((_, index) => index % 6 === 0).forEach((hour) => {
    const row = element('tr');
    const time = element('th', dateFormat(lang, hour.time, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })); time.scope = 'row'; row.append(time);
    for (const value of [hour.airTemperatureC, hour.windSpeedMs, hour.precipitationMm, hour.seaTemperatureC, hour.waveHeightM]) row.append(element('td', value === null ? '—' : value.toFixed(1)));
    tbody.append(row);
  });
  table.append(tbody); wrap.append(table); details.append(wrap); body.append(details);
  const sources = element('div', '', 'forecast-sources');
  for (const [key, source] of [['Weather', forecast.weather], ['Marine', forecast.marine]] as const) {
    const line = element('p'); const link = element('a', `${source.provider} · ${source.model}`); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(link);
    line.append(document.createTextNode(source.grid
      ? ` · ${source.grid.latitude.toFixed(4)}, ${source.grid.longitude.toFixed(4)} · ${source.grid.distanceKm} km ${ja ? '区画から' : 'from plot'}`
      : ` · ${key}: ${ja ? '利用不可' : source.status}`));
    sources.append(line);
  }
  body.append(sources); target.replaceChildren(body);
}

export function initWeatherForecast(scene: HTMLElement) {
  let pending: AbortController | undefined;
  let last: { panel: HTMLElement; fetchedAt: number } | undefined;
  async function load(force = false) {
    const panel = scene.querySelector<HTMLElement>('.weather-forecast');
    if (!panel || panel.dataset.weatherOperational !== 'true') return;
    const status = panel.querySelector<HTMLElement>('[data-weather-status]')!;
    const button = panel.querySelector<HTMLButtonElement>('[data-weather-refresh]')!;
    const target = panel.querySelector<HTMLElement>('[data-weather-content]')!;
    const lang = panel.dataset.weatherLang === 'ja' ? 'ja' : 'en', ja = lang === 'ja';
    if (!panel.dataset.weatherLocation) return;
    if (!force && last?.panel === panel && Date.now() / 1000 - last.fetchedAt < 900) return;
    pending?.abort(); const controller = new AbortController(); pending = controller;
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
          : (ja ? '予報取得済み · モデル予報、実測ではありません' : 'Forecast loaded · model guidance, not observations');
      renderForecast(target, result, lang);
      last = result.status === 'stale' ? undefined : { panel, fetchedAt: result.fetchedAt };
    } catch {
      if (pending !== controller || controller.signal.aborted || !panel.isConnected) return;
      target.replaceChildren(); last = undefined;
      status.textContent = ja ? '予報サービスに接続できません。更新で再試行できます。' : 'Forecast service unavailable. Use Refresh to retry.';
    } finally {
      if (pending === controller) { button.disabled = false; panel.removeAttribute('aria-busy'); }
    }
  }
  scene.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-weather-refresh]')) void load(true);
  });
  return {
    open: () => { void load(); },
    reset: () => { pending?.abort(); pending = undefined; last = undefined; if (scene.querySelector('#forecast-shelf[data-open]')) void load(); },
  };
}
