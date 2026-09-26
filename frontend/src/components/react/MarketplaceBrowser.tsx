import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  marketplaceCopy, type MarketplaceLocale, type MarketplacePreviewItem,
  type PreviewAvailability, type PreviewSpecies,
} from '../../fixtures/marketplace-preview';
import { filterPreviewItems } from '../organisms/marketplace/filter';

interface Props {
  items: MarketplacePreviewItem[];
  children: ReactNode;
  initialLocale?: MarketplaceLocale;
  initialQuery?: string;
  initialSpecies?: PreviewSpecies | 'all';
  initialAvailability?: PreviewAvailability | 'all';
  initialState?: 'ready' | 'loading' | 'unavailable';
  /** Copy set; defaults to the sample-preview wording. The live storefront passes its own. */
  copy?: MarketplaceCopy;
  live?: boolean;
}

export type MarketplaceCopy = Record<MarketplaceLocale, Record<keyof typeof marketplaceCopy.en, string>>;

/** Local preview controller. It never reads a wallet or calls a service. */
export default function MarketplaceBrowser({
  items, children, initialLocale = 'en', initialQuery = '', initialSpecies = 'all',
  initialAvailability = 'all', initialState = 'ready', copy = marketplaceCopy, live = false,
}: Props) {
  const [locale, setLocale] = useState(initialLocale);
  const [query, setQuery] = useState(initialQuery);
  const [species, setSpecies] = useState(initialSpecies);
  const [availability, setAvailability] = useState(initialAvailability);
  const [state, setState] = useState(initialState);
  const cards = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const t = copy[locale];
  const speciesOptions = [...new Map(items.map(item => [item.species, item])).values()];
  const visible = useMemo(() => filterPreviewItems(items, { query, species, availability }), [items, query, species, availability]);

  useEffect(() => {
    // Astro owns the card markup. Only visibility and translated preview labels
    // are enhanced here, so the actual shared MarketCard stays in use.
    const ids = new Set(visible.map(item => item.lot.id));
    for (const card of cards.current?.querySelectorAll<HTMLElement>('[data-market-preview-item]') ?? []) {
      card.hidden = !ids.has(card.dataset.marketPreviewItem ?? '');
      for (const label of card.querySelectorAll<HTMLElement>('[data-preview-en][data-preview-ja]')) {
        label.textContent = (locale === 'ja' ? label.dataset.previewJa : label.dataset.previewEn) ?? '';
      }
      const c = copy[locale];
      const localizedLabels = [
        ['.market-card__status strong', c.previewBadge],
        ['.market-card__image-facts small', c.sampleLanding],
        ['.market-card__action', c.view],
      ] as const;
      for (const [selector, text] of localizedLabels) {
        const label = card.querySelector<HTMLElement>(selector);
        if (label) label.textContent = text;
      }
      const image = card.querySelector<HTMLImageElement>('.market-card__media img');
      if (image) image.alt = c.imageAlt;
    }
  }, [visible, locale, copy]);

  function revealDetail(event: MouseEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#market-preview-detail-"]');
    if (!link || !cards.current?.contains(link)) return;
    const detail = cards.current.querySelector<HTMLDetailsElement>(link.hash);
    if (!detail) return;
    event.preventDefault();
    detail.open = true;
    detail.querySelector('summary')?.focus();
  }

  function resetFilters() { setQuery(''); setSpecies('all'); setAvailability('all'); }

  return <section className="marketplace-preview" lang={locale} aria-label={t.title}>
    <div className="marketplace-preview__toolbar">
      {live ? <p>{t.preview}</p> : <span className="market-kicker">ReelDeal</span>}
      <nav aria-label={t.language} className="marketplace-preview__languages">
        <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
        <button type="button" lang="ja" aria-pressed={locale === 'ja'} onClick={() => setLocale('ja')}>日本語</button>
      </nav>
    </div>
    {!live && <><header className="marketplace-preview__heading"><h1>{t.title}</h1><p>{t.subtitle}</p></header>
    <p className="notice">{t.preview}</p></>}
    <fieldset className="marketplace-preview__filters" disabled={state !== 'ready'}>
      <legend className="marketplace-preview__sr-only">{t.species} · {t.availability}</legend>
      <label className="field" htmlFor={inputId}>{t.search}
        <input id={inputId} className="input" type="search" value={query} placeholder={t.searchHint} autoComplete="off" onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="marketplace-preview__selects">
        <label className="field">{t.species}<select className="input" value={species} onChange={event => setSpecies(event.target.value as PreviewSpecies | 'all')}>
          <option value="all">{t.allSpecies}</option>
          {speciesOptions.map(item => <option key={item.species} value={item.species}>{locale === 'ja' ? item.nameJa : live ? item.englishName : item.lot.species}</option>)}
        </select></label>
        {!live && <label className="field">{t.availability}<select className="input" value={availability} onChange={event => setAvailability(event.target.value as PreviewAvailability | 'all')}>
          <option value="all">{t.allAvailability}</option>
          <option value="open">{t.open}</option><option value="reserved">{t.reserved}</option><option value="sold">{t.sold}</option>
          {items.some(item => item.availability === 'unknown') && <option value="unknown">{t.unknown}</option>}
        </select></label>}
      </div>
    </fieldset>
    <div className="marketplace-preview__results" role="status" aria-live="polite">
      {state === 'ready' ? `${visible.length} ${live && locale === 'en' && visible.length === 1 ? 'item' : t.count}` : state === 'loading' ? t.loading : t.unavailable}
    </div>
    {state !== 'ready' && <button className="rd-ui-button rd-ui-button--yellow" type="button" onClick={() => setState('ready')}>{t.retry}</button>}
    {state === 'ready' && visible.length === 0 && <div className="market-empty"><p>{t.empty}</p><button className="rd-ui-button rd-ui-button--secondary" type="button" onClick={resetFilters}>{t.reset}</button></div>}
    <div ref={cards} hidden={state !== 'ready'} onClick={revealDetail}>{children}</div>
    {t.sharedCopy && <p className="marketplace-preview__note">{t.sharedCopy}</p>}
  </section>;
}
