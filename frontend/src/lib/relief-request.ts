import type { Hex } from 'viem';

export interface ReliefRequest {
  plotLabel: string;
  season: string;
  eventId?: Hex;
}

export function parseReliefRequest(plotLabel: string | undefined, query: URLSearchParams): ReliefRequest | null {
  if (!plotLabel || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(plotLabel)) return null;
  if (['season', 'eventId', 'plot'].some((key) => query.getAll(key).length > 1)) return null;
  const season = query.has('season') ? query.get('season')! : '2026';
  if (!/^20\d{2}$/.test(season)) return null;
  const eventId = query.get('eventId');
  if (eventId !== null && !/^0x[0-9a-fA-F]{64}$/.test(eventId)) return null;
  return { plotLabel, season, ...(eventId ? { eventId: eventId as Hex } : {}) };
}
