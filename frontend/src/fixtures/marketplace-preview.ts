import { previewLots, type PreviewLot } from './preview-lots';
import type { ContributionSplitProps } from '../components/molecules/relief/props';

export type MarketplaceLocale = 'en' | 'ja';
export type PreviewAvailability = 'open' | 'reserved' | 'sold' | 'unknown';
// A local filter key, not a shared species schema.
export type PreviewSpecies = string;
export interface MarketplacePreviewItem {
  lot: PreviewLot;
  species: PreviewSpecies;
  nameJa: string;
  englishName: string;
  availability: PreviewAvailability;
}

const speciesNames = new Map([
  ['katsuo', { nameJa: 'カツオ', englishName: 'Skipjack tuna' }],
  ['sanma', { nameJa: 'サンマ', englishName: 'Pacific saury' }],
  ['saba', { nameJa: 'サバ', englishName: 'Chub mackerel' }],
  ['hotate', { nameJa: 'ホタテ', englishName: 'Scallop' }],
  ['mebachi', { nameJa: 'メバチマグロ', englishName: 'Bigeye tuna' }],
  ['awabi', { nameJa: 'アワビ', englishName: 'Abalone' }],
]);

// These states are synthetic display fixtures, not live inventory or reservations.
// Availability belongs to the sample lot, never its position or species.
const sampleAvailability = new Map<string, PreviewAvailability>([
  ['RD-LOT-001', 'open'],
  ['RD-LOT-002', 'reserved'],
  ['RD-LOT-003', 'sold'],
]);

export function createMarketplacePreviewItems(lots: readonly PreviewLot[]): MarketplacePreviewItem[] {
  return lots.map(lot => {
    const species = lot.species.trim().toLowerCase();
    const names = speciesNames.get(species) ?? { nameJa: lot.species, englishName: lot.species };
    return { lot, species, ...names, availability: sampleAvailability.get(lot.id) ?? 'unknown' };
  });
}

export const marketplacePreviewItems = createMarketplacePreviewItems(previewLots);

export const marketplaceCopy = {
  en: {
    title: 'Find your fish', language: 'Language', subtitle: 'Prices in JPY · settlement in JPYC',
    preview: 'Sample inventory · local filters only. No live stock, orders or payments.',
    search: 'Search fish', searchHint: 'Try saba, tuna or サバ', species: 'Species',
    allSpecies: 'All fish', availability: 'Availability', allAvailability: 'All states',
    open: 'Open', reserved: 'Reserved', sold: 'Sold', unknown: 'Availability not specified', count: 'sample lots shown',
    empty: 'No sample lots match. Try another fish or availability.', reset: 'Clear filters',
    loading: 'Loading preview inventory…', unavailable: 'Preview inventory unavailable.',
    retry: 'Load sample inventory', details: 'Sample lot details', weight: 'Weight', length: 'Length',
    noReceipt: 'Illustration only. No landing photo, reservation or sale receipt.',
    previewBadge: 'Preview', sampleLanding: 'Sample landing', view: 'View',
    imageAlt: 'Illustrated seafood; no landing photograph',
    sharedCopy: 'Sample lot details only. Checkout states are separate previews.',
  },
  ja: {
    title: '魚を探す', language: '言語', subtitle: '価格表示：日本円 · 決済通貨：JPYC',
    preview: 'サンプル在庫です。絞り込みはこの画面内のみで、実際の注文や決済は行いません。',
    search: '魚を検索', searchHint: 'サバ、カツオ、saba など', species: '魚種',
    allSpecies: 'すべての魚', availability: '販売状況', allAvailability: 'すべての状態',
    open: '販売中', reserved: '予約済み', sold: '売約済み', unknown: '販売状況は未設定', count: '件のサンプルを表示',
    empty: '該当するサンプル商品がありません。魚種や販売状況を変えてください。', reset: '絞り込みを解除',
    loading: 'プレビュー在庫を読み込み中…', unavailable: 'プレビュー在庫を読み込めません。',
    retry: 'サンプル在庫を表示', details: 'サンプル商品情報', weight: '重量', length: '全長',
    noReceipt: 'イラストです。水揚げ写真・予約・取引記録はありません。',
    previewBadge: 'プレビュー', sampleLanding: 'サンプル商品', view: '詳細',
    imageAlt: '魚介類のイラスト。水揚げ写真ではありません。',
    sharedCopy: 'サンプル商品情報です。決済の各状態は別のプレビューで確認できます。',
  },
} as const;

export type CheckoutPreviewState = 'approval' | 'rejected' | 'submitted' | 'confirmed' | 'failed' | 'unavailable';

interface CheckoutPresentation {
  heading: string;
  message: string;
  actionLabel: string;
  split: ContributionSplitProps;
}

const split: ContributionSplitProps = {
  reference: 'Sample order · RD-LOT-001', saleAmount: '2800', sellerAmount: '2520', fundAmount: '280',
  fundShareLabel: '10% example', state: 'proposed',
  explanation: 'Illustrative allocation only. This is not a server quote, inventory reservation or transfer.',
};

export const checkoutPreviews: Record<CheckoutPreviewState, CheckoutPresentation> = {
  approval: {
    heading: 'Review the contribution',
    message: 'A real checkout must obtain a server-validated quote before requesting approval. This sample shows the split first.',
    actionLabel: 'Approve JPYC · preview only', split,
  },
  rejected: {
    heading: 'Approval declined',
    message: 'Example wallet rejection. No approval or purchase was submitted.',
    actionLabel: 'Try approval again · preview only', split,
  },
  submitted: {
    heading: 'Awaiting confirmation',
    message: 'Example submitted state. Submission does not mark the order paid; confirmation requires a matching successful receipt and events.',
    actionLabel: 'Waiting for confirmation',
    split: { ...split, state: 'pending', explanation: 'Synthetic submitted contribution awaiting confirmation. This is not a payment receipt.' },
  },
  confirmed: {
    heading: 'Sample payment confirmed',
    message: 'Synthetic confirmed state. There is no real transaction, receipt or transfer behind this preview.',
    actionLabel: 'Sample receipt · preview only',
    split: { ...split, state: 'paid', explanation: 'This synthetic state represents a confirmed contribution. No funds moved.' },
  },
  failed: {
    heading: 'Sample payment failed',
    message: 'Example failed transaction. Do not mark the order paid or automatically submit another payment.',
    actionLabel: 'Review order · preview only',
    split: { ...split, state: 'unavailable', explanation: 'The displayed allocation is an example, not a completed contribution.' },
  },
  unavailable: {
    heading: 'Checkout unavailable',
    message: 'A current quote cannot be loaded. The sample price is not an offer and cannot be approved.',
    actionLabel: 'Checkout unavailable',
    split: { ...split, state: 'unavailable', explanation: 'No authoritative quote or transfer status is available.' },
  },
};
