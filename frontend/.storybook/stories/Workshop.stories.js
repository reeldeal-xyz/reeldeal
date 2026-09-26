import Workshop from '../../src/workshop/Workshop.astro';
export default { title: 'ReelDeal/04 Pages/Workshop', component: Workshop, parameters: { layout: 'fullscreen' } };
export const Mobile = {};
export const Narrow = { globals: { viewport: { value: 'mobile320', isRotated: false } } };
export const Desktop = { globals: { viewport: { value: 'desktop1440', isRotated: false } } };
