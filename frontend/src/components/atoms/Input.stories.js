import Input from './Input.astro';
export default { title: 'ReelDeal/01 Atoms/Input', component: Input, args: { id: 'amount', 'aria-label': 'Contribution in JPYC', placeholder: 'Amount in JPYC', inputmode: 'decimal' } };
export const Default = {};
export const Disabled = { args: { disabled: true, value: '20000' } };
export const Invalid = { args: { invalid: true, value: 'abc' } };
