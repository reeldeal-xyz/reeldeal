// Fixture fallback for the real (not synthetic) 2026 scallop BANWEEKS toxin-ban trigger that issue #28
// verified against the pinned prefecture PDFs — see pipeline/data/toxin/scallop-ban-2026.json and
// pipeline/src/banweeks.ts (the actual computation this mirrors). Once the pipeline feed serves
// GET /triggers/:zone/2026, that real response is used instead (see lib/feed-client.ts); this only
// covers the feed being unreachable. Unlike the HEAT fixtures in series.ts, these dates are NOT
// synthetic — they come from buildBanweeksTrigger(scallop-ban-2026.json) and are pinned here as literals
// so the map (#18) can show them without duplicating the weekly-series/index logic client-side.
import { idOf, type ReplayTrigger, type Zone } from '@repo/shared';
import type { Hex } from 'viem';

// sha256 of the pinned PDF (pipeline/data/toxin/miyagi-mahi-kaidoku-2026-09-15.pdf), from
// pipeline/data/toxin/scallop-ban-2026.json#source.sha256.
const TOXIN_PDF_SHA256: Hex = '0x39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708';

const toEpochSeconds = (isoDate: string): bigint => BigInt(Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000));

interface BanweeksFixture {
  banStart: string;
  firedOn: string;
}

// From pipeline/data/toxin/scallop-ban-2026.json (banStart) and pipeline/test/banweeks.test.ts
// (verified fire dates, both reproduced by buildBanweeksTrigger with RULES' BANWEEKS threshold of 4).
const BANWEEKS_2026: Record<Zone, BanweeksFixture> = {
  'karakuwa-east': { banStart: '2026-05-12', firedOn: '2026-06-02' },
  'kesennuma-bay': { banStart: '2026-05-26', firedOn: '2026-06-16' },
};

export const BANWEEKS_SEASON = '2026';

export function fixtureBanweeksTriggers(zone: Zone): ReplayTrigger[] {
  const entry = BANWEEKS_2026[zone];
  const firedAt = toEpochSeconds(entry.firedOn);
  return [
    {
      label: 'scallop:1',
      zone,
      species: 'scallop',
      peril: 'BANWEEKS',
      firedOn: entry.firedOn,
      trigger: {
        zoneId: idOf(zone),
        speciesId: idOf('scallop'),
        perilId: idOf('BANWEEKS'),
        tier: 1,
        seasonLabel: BANWEEKS_SEASON,
        windowStart: toEpochSeconds(entry.banStart).toString(),
        windowEnd: firedAt.toString(),
        firedAt: firedAt.toString(),
        index: 4,
        threshold: 4,
        tempC: 0, // BANWEEKS has no temperature
        dataHash: TOXIN_PDF_SHA256,
        deadline: (firedAt + 90n * 24n * 60n * 60n).toString(),
      },
      signatures: [],
    },
  ];
}
