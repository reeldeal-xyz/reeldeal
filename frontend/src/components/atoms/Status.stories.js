import Status from './Status.astro';
export default { title: 'ReelDeal/01 Atoms/Status', component: Status };
export const Pending = { args: { state: 'pending', detail: 'Awaiting confirmation' } };
export const Paid = { args: { state: 'paid', detail: 'Confirmed transfer' } };
export const Held = { args: { state: 'held', detail: 'Identity verification is required before release' } };
export const Loading = { args: { state: 'loading' } };
export const Unavailable = { args: { state: 'unavailable', detail: 'Try again shortly' } };
export const UnknownStatus = { args: { state: 'unexpected' } };
export const AdvisoryOnly = { args: { state: 'advisory', detail: 'A forecast does not confirm a threshold crossing' } };
