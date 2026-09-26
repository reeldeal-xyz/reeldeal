const illustrations = new Map([
  ['katsuo', 'katsuo-ice.webp'],
  ['sanma', 'sanma-ice.webp'],
  ['saba', 'saba-ice.webp'],
  ['hotate', 'hotate-ice.webp'],
  ['scallop', 'hotate-ice.webp'],
  ['hoya', 'hoya-ice.webp'],
  ['oyster', 'oyster-ice.webp'],
  ['wakame', 'wakame-ice.webp'],
  ['mebachi', 'maguro-ice.webp'],
  ['maguro', 'maguro-ice.webp'],
  ['awabi', 'awabi-ice.webp'],
]);

export function fishIllustration(species?: string) {
  const file = illustrations.get(species?.trim().toLowerCase() ?? '');
  return file
    ? { src: `/images/fish/${file}`, alt: `${species?.trim()} on ice (generated illustration)` }
    : { src: '/images/landing-placeholder.png', alt: 'Illustrated fish silhouette; no landing photograph' };
}
