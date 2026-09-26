import Address from './Address.astro';
export default { title: 'ReelDeal/01 Atoms/Address', component: Address, args: { value: '0x0000000000000000000000000000000000000001' } };
export const Full = {};
export const Compact = { args: { compact: true } };
export const Missing = { args: { value: undefined } };
