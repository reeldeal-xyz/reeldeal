import Field from './Field.astro';
export default { title: 'ReelDeal/01 Atoms/Field', component: Field, args: { id: 'farm-name', label: 'Farm name / 養殖場名', hint: 'Use the name registered with your co-op.' } };
export const Empty = {};
export const Filled = { args: { value: 'Karakuwa oyster farm' } };
export const Required = { args: { required: true } };
export const Error = { args: { error: 'Enter the farm name before continuing.' } };
export const Disabled = { args: { disabled: true, value: 'Karakuwa oyster farm' } };
