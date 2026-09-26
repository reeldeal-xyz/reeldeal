import { z } from 'zod';

const number = z.number().finite();
export const forecastLocation = z.object({ latitude: number.min(20).max(46.5), longitude: number.min(122).max(154) }).strict();
const time = z.number().int().positive();
const temperature = number.min(-100).max(70).nullable();
const nonnegative = number.nonnegative().nullable();

export const weatherForecastPoint = z.object({
  time,
  airTemperatureC: temperature,
  precipitationMm: nonnegative,
  windSpeedMs: nonnegative,
  windDirectionDeg: number.min(0).max(360).nullable(),
  weatherCode: z.number().int().min(0).max(99).nullable(),
  seaTemperatureC: temperature,
  waveHeightM: nonnegative,
  wavePeriodS: nonnegative,
}).strict();
const source = z.object({
  status: z.enum(['available', 'unavailable', 'invalid-payload']),
  provider: z.literal('Open-Meteo'),
  model: z.string().min(1),
  url: z.enum(['https://open-meteo.com/en/docs/jma-api', 'https://open-meteo.com/en/docs/marine-weather-api']),
  grid: z.object({ latitude: number.min(-90).max(90), longitude: number.min(-180).max(180), distanceKm: number.min(0).max(150) }).strict().nullable(),
}).strict();

export const weatherForecast = z.object({
  kind: z.literal('forecast'),
  status: z.enum(['available', 'partial', 'stale', 'unavailable']),
  requested: forecastLocation,
  timezone: z.literal('Asia/Tokyo'),
  fetchedAt: time,
  weather: source,
  marine: source,
  hours: z.array(weatherForecastPoint).max(72),
}).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  const weatherKeys = ['airTemperatureC', 'precipitationMm', 'windSpeedMs', 'windDirectionDeg', 'weatherCode'] as const;
  const marineKeys = ['seaTemperatureC', 'waveHeightM', 'wavePeriodS'] as const;
  const hasValues = value.hours.some((hour) => [...weatherKeys, ...marineKeys].some((key) => hour[key] !== null));
  if (value.status === 'unavailable' ? value.hours.length !== 0 : !hasValues) invalid('Forecast status disagrees with data availability');
  if (value.weather.url !== 'https://open-meteo.com/en/docs/jma-api' || value.marine.url !== 'https://open-meteo.com/en/docs/marine-weather-api') invalid('Wrong source attribution');
  for (const [source, keys] of [[value.weather, weatherKeys], [value.marine, marineKeys]] as const) {
    if ((source.status === 'available') !== (source.grid !== null)) invalid('Source status disagrees with grid metadata');
    if (source.status !== 'available' && value.hours.some((hour) => keys.some((key) => hour[key] !== null))) invalid('Values from an unavailable source');
  }
  if (value.status === 'available' && (value.hours.length !== 72 || value.weather.status !== 'available'
    || value.marine.status !== 'available' || value.hours.some((hour) => [...weatherKeys, ...marineKeys].some((key) => hour[key] === null)))) invalid('Incomplete forecast marked complete');
  if (value.hours.length && Math.abs(value.hours[0]!.time - Math.floor(value.fetchedAt / 3600) * 3600) > 3600) invalid('Forecast does not start near retrieval hour');
  if (value.hours.some((hour) => hour.time % 3600 !== 0)) invalid('Forecast timestamps must be UTC hours');
  for (let i = 1; i < value.hours.length; i++) {
    if (value.hours[i]!.time !== value.hours[i - 1]!.time + 3600) invalid('Unordered forecast hours');
  }
});

const rawBase = {
  latitude: number.min(-90).max(90), longitude: number.min(-180).max(180),
  utc_offset_seconds: z.literal(32400), timezone: z.literal('Asia/Tokyo'),
};
const timestamps = z.array(time).length(72);
export const openMeteoWeather = z.object({
  ...rawBase,
  hourly_units: z.object({ time: z.literal('unixtime'), temperature_2m: z.literal('°C'), precipitation: z.literal('mm'), wind_speed_10m: z.literal('m/s'), wind_direction_10m: z.literal('°'), weather_code: z.literal('wmo code') }),
  hourly: z.object({
    time: timestamps, temperature_2m: z.array(temperature).length(72), precipitation: z.array(nonnegative).length(72),
    wind_speed_10m: z.array(nonnegative).length(72), wind_direction_10m: z.array(number.min(0).max(360).nullable()).length(72),
    weather_code: z.array(z.number().int().min(0).max(99).nullable()).length(72),
  }),
});
export const openMeteoMarine = z.object({
  ...rawBase,
  hourly_units: z.object({ time: z.literal('unixtime'), sea_surface_temperature: z.literal('°C'), wave_height: z.literal('m'), wave_period: z.literal('s') }),
  hourly: z.object({ time: timestamps, sea_surface_temperature: z.array(temperature).length(72), wave_height: z.array(nonnegative).length(72), wave_period: z.array(nonnegative).length(72) }),
});

export type ForecastLocation = z.infer<typeof forecastLocation>;
export type WeatherForecast = z.infer<typeof weatherForecast>;
export type WeatherForecastPoint = z.infer<typeof weatherForecastPoint>;
