import Amount from './Amount.astro';
export default { title: 'ReelDeal/01 Atoms/Amount', component: Amount, args: { value: '20000', currency: 'JPYC' } };
export const JPYC = {};
export const JPY = { args: { value: '2400', currency: 'JPY' } };
export const Large = { args: { value: '9007199254740993.000000000000000001' } };
export const Zero = { args: { value: '0' } };
export const Unavailable = { args: { value: 'unknown' } };
