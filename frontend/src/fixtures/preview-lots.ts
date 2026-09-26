export type PreviewLot = {
  id: string;
  species: string;
  lengthMm?: number;
  weightG?: number;
  priceJpy: number;
  status?: string;
  note?: string;
};

// Static preview content until RD-25's seed and RD-18's listing API arrive.
export const previewLots: PreviewLot[] = [
  {
    id: 'RD-LOT-001',
    species: 'Katsuo',
    lengthMm: 412,
    weightG: 1480,
    priceJpy: 2800,
    status: 'Preview lot',
    note: 'Species label confirmed · review pending',
  },
  {
    id: 'RD-LOT-002',
    species: 'Sanma',
    lengthMm: 318,
    weightG: 265,
    priceJpy: 760,
    status: 'Preview lot',
    note: 'Species label confirmed · review pending',
  },
  {
    id: 'RD-LOT-003',
    species: 'Saba',
    lengthMm: 365,
    weightG: 690,
    priceJpy: 1240,
    status: 'Preview lot',
    note: 'Species label confirmed · review pending',
  },
  {
    id: 'RD-LOT-004',
    species: 'Hotate',
    lengthMm: 110,
    weightG: 220,
    priceJpy: 3800,
    status: 'Preview lot',
    note: 'Sample inventory',
  },
  {
    id: 'RD-LOT-005',
    species: 'Mebachi',
    lengthMm: 1100,
    weightG: 18000,
    priceJpy: 4500,
    status: 'Preview lot',
    note: 'Sample inventory',
  },
  {
    id: 'RD-LOT-006',
    species: 'Awabi',
    lengthMm: 95,
    weightG: 180,
    priceJpy: 12000,
    status: 'Preview lot',
    note: 'Sample inventory',
  },
];
