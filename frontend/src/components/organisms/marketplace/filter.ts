import type { MarketplacePreviewItem, PreviewAvailability, PreviewSpecies } from '../../../fixtures/marketplace-preview';

export interface PreviewFilters {
  query: string;
  species: PreviewSpecies | 'all';
  availability: PreviewAvailability | 'all';
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();

export function filterPreviewItems(items: readonly MarketplacePreviewItem[], filters: PreviewFilters) {
  const query = normalize(filters.query);
  return items.filter(item =>
    (filters.species === 'all' || item.species === filters.species)
    && (filters.availability === 'all' || item.availability === filters.availability)
    && normalize(`${item.lot.species} ${item.nameJa} ${item.englishName}`).includes(query),
  );
}
