import { describe, expect, test } from 'bun:test';
import { marketplacePreviewItems } from '../../../fixtures/marketplace-preview';
import { filterPreviewItems } from './filter';

describe('local marketplace discovery', () => {
  test('finds the same fish through English, Japanese and full-width search', () => {
    for (const query of ['SABA', 'サバ', ' ＳＡＢＡ ', 'chub mackerel']) {
      expect(filterPreviewItems(marketplacePreviewItems, { query, species: 'all', availability: 'all' }).map(item => item.species)).toEqual(['saba']);
    }
  });

  test('combines species, query and availability without changing fixture inventory', () => {
    expect(filterPreviewItems(marketplacePreviewItems, { query: 'tuna', species: 'katsuo', availability: 'open' })).toHaveLength(1);
    expect(filterPreviewItems(marketplacePreviewItems, { query: 'tuna', species: 'katsuo', availability: 'sold' })).toHaveLength(0);
    expect(filterPreviewItems(marketplacePreviewItems, { query: '', species: 'all', availability: 'all' })).toHaveLength(3);
    expect(marketplacePreviewItems).toHaveLength(3);
  });
});
