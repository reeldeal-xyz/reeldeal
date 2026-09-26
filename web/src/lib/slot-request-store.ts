// TODO(#15): the LIFF app has no "request this season's slot" API yet. This in-memory store (with a
// best-effort JSON file mirror so it survives `next dev` reloads) stands in for it so the holder screen
// (issue #19) has real requests to list, issue and revoke. Once #15 ships the real endpoint, point the
// `slotRequestStore` export at a store backed by it — the SlotRequestStore interface and the route handlers in
// app/api/holder/requests/ are written so that's a one-file swap, no screen code changes.
//
// This is deliberate module-level mutable state (unlike the "no shared module state in RSC" rule, which is
// about accidentally leaking per-request data): it is only touched from Route Handlers, never from a Server
// Component render, and its whole job is to persist across requests until a real backend exists.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SlotRequestStatus = 'pending' | 'issued' | 'revoked';

export interface SlotRequest {
  id: string;
  plotLabel: string;
  farmerAddress: string;
  farmerName?: string;
  /** LINE `sub` of the requester (issue #15's LIFF "request this season's slot" form). Optional because the
   *  seed data and any pre-#15 caller never set it. */
  lineUserId?: string;
  seasonLabel: string;
  requestedAt: string;
  status: SlotRequestStatus;
}

export type NewSlotRequest = Pick<SlotRequest, 'plotLabel' | 'farmerAddress' | 'seasonLabel'> &
  Partial<Pick<SlotRequest, 'farmerName' | 'lineUserId'>>;

export interface SlotRequestStore {
  list(): Promise<SlotRequest[]>;
  create(input: NewSlotRequest): Promise<SlotRequest>;
  updateStatus(id: string, status: SlotRequestStatus): Promise<SlotRequest | undefined>;
}

const STORE_FILE = join(tmpdir(), 'eth-global-tokyo-slot-requests.json');

const SEED: SlotRequest[] = [
  {
    id: 'seed-1',
    plotLabel: 'p1213-001',
    farmerAddress: '0x1111111111111111111111111111111111111a',
    farmerName: 'Farmer (LINE demo)',
    seasonLabel: '2026',
    requestedAt: new Date(Date.UTC(2026, 8, 1)).toISOString(),
    status: 'pending',
  },
  {
    id: 'seed-2',
    plotLabel: 'p1213-009',
    farmerAddress: '0x2222222222222222222222222222222222222b',
    farmerName: 'Farmer (LINE demo)',
    seasonLabel: '2026',
    requestedAt: new Date(Date.UTC(2026, 8, 3)).toISOString(),
    status: 'pending',
  },
];

class InMemorySlotRequestStore implements SlotRequestStore {
  private requests: SlotRequest[] | undefined;

  private async load(): Promise<SlotRequest[]> {
    if (this.requests) return this.requests;
    try {
      const raw = await readFile(STORE_FILE, 'utf8');
      this.requests = JSON.parse(raw) as SlotRequest[];
    } catch {
      this.requests = [...SEED];
    }
    return this.requests;
  }

  private async persist() {
    try {
      await mkdir(tmpdir(), { recursive: true });
      await writeFile(STORE_FILE, JSON.stringify(this.requests, null, 2), 'utf8');
    } catch {
      // Best-effort only — an in-memory-only fallback (e.g. a read-only filesystem) is fine for a demo.
    }
  }

  async list(): Promise<SlotRequest[]> {
    const requests = await this.load();
    return [...requests].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async create(input: NewSlotRequest): Promise<SlotRequest> {
    const requests = await this.load();
    const request: SlotRequest = {
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
      status: 'pending',
      ...input,
    };
    requests.push(request);
    await this.persist();
    return request;
  }

  async updateStatus(id: string, status: SlotRequestStatus): Promise<SlotRequest | undefined> {
    const requests = await this.load();
    const request = requests.find((r) => r.id === id);
    if (!request) return undefined;
    request.status = status;
    await this.persist();
    return request;
  }
}

export const slotRequestStore: SlotRequestStore = new InMemorySlotRequestStore();
