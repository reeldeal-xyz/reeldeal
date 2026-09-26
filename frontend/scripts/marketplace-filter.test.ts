import { describe, expect, test } from 'bun:test';
import { createMarketplacePreviewItems, marketplacePreviewItems } from '../src/fixtures/marketplace-preview';
import { previewLots } from '../src/fixtures/preview-lots';
import { filterPreviewItems } from '../src/components/organisms/marketplace/filter';

describe('local marketplace discovery', () => {
  test('finds the same fish through English, Japanese and full-width search', () => {
    for (const query of ['SABA', 'サバ', ' ＳＡＢＡ ', 'chub mackerel']) {
      expect(filterPreviewItems(marketplacePreviewItems, { query, species: 'all', availability: 'all' }).map(item => item.species)).toEqual(['saba']);
    }
  });

  test('combines species, query and availability without changing fixture inventory', () => {
    expect(filterPreviewItems(marketplacePreviewItems, { query: 'tuna', species: 'katsuo', availability: 'open' })).toHaveLength(1);
    expect(filterPreviewItems(marketplacePreviewItems, { query: 'tuna', species: 'katsuo', availability: 'sold' })).toHaveLength(0);
    expect(filterPreviewItems(marketplacePreviewItems, { query: '', species: 'all', availability: 'all' })).toHaveLength(previewLots.length);
    expect(marketplacePreviewItems).toHaveLength(previewLots.length);
  });

  test('keeps names and sample availability attached to expanded and reordered lots', () => {
    const expanded = ['Katsuo', 'Sanma', 'Saba', 'Hotate', 'Mebachi', 'Awabi'].map((species, index) => ({
      ...previewLots[0], id: `RD-LOT-00${index + 1}`, species,
    }));
    const before = structuredClone(expanded);
    const ordered = createMarketplacePreviewItems(expanded);
    const reordered = createMarketplacePreviewItems([...expanded].reverse());
    expect(reordered).toEqual([...ordered].reverse());
    expect(ordered.map(({ nameJa, englishName, availability }) => [nameJa, englishName, availability])).toEqual([
      ['カツオ', 'Skipjack tuna', 'open'], ['サンマ', 'Pacific saury', 'reserved'], ['サバ', 'Chub mackerel', 'sold'],
      ['ホタテ', 'Scallop', 'unknown'], ['メバチマグロ', 'Bigeye tuna', 'unknown'], ['アワビ', 'Abalone', 'unknown'],
    ]);
    expect(filterPreviewItems(reordered, { query: 'メバチ', species: 'mebachi', availability: 'unknown' }).map(item => item.lot.id)).toEqual(['RD-LOT-005']);
    expect(filterPreviewItems(reordered, { query: 'abalone', species: 'all', availability: 'all' }).map(item => item.lot.id)).toEqual(['RD-LOT-006']);
    for (const [index, item] of ordered.entries()) expect(item.lot).toBe(expanded[index]);
    expect(expanded).toEqual(before);
  });

  test('retains unknown species and does not copy sold state to another lot of the same species', () => {
    const extraLots = [
      { ...previewLots[0], id: 'sample-unknown', species: 'Local oyster' },
      { ...previewLots[0], id: 'sample-second-saba', species: 'Saba' },
    ];
    const items = createMarketplacePreviewItems(extraLots);
    expect(items[0]).toMatchObject({ species: 'local oyster', nameJa: 'Local oyster', englishName: 'Local oyster', availability: 'unknown' });
    expect(items[1]).toMatchObject({ species: 'saba', nameJa: 'サバ', availability: 'unknown' });
    expect(filterPreviewItems(items, { query: 'oyster', species: 'all', availability: 'all' }).map(item => item.lot.id)).toEqual(['sample-unknown']);
    expect(filterPreviewItems(items, { query: '', species: 'all', availability: 'open' })).toHaveLength(0);
  });
});
