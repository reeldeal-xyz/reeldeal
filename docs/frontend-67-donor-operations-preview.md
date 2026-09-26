# Donor and operations previews (#67)

This frontend slice adds connected Astro preview screens and Storybook states
for the donor, season-slot holder and co-op. It extends the
[farmer relief preview](frontend-67-preview.md). The existing live routes remain
owned by `web/`; #67 remains open until its domain, server and wallet integration
acceptance is complete.

## Review the flow

Run `bun run frontend:dev`, then open `/preview`. The same donor and operations
components have named states under **ReelDeal → 03 Organisms** in Storybook.
The overview also links the existing marketplace and farmer organisms.

All actions and data are synthetic. Controls update memory in the current
screen, and reloading or navigating away resets that state. No wallet is
opened, no transaction is sent, and no identity, registration or payout is
changed. Sample pool history is kept separate from the donor's local activity;
neither is an authoritative relief ledger.

| Screen | Behavior |
| --- | --- |
| Donor | Exact decimal JPYC entry with 18 base-unit decimals; amount and memo are captured before a local request. |
| Approval | Review, cancellation, rejection, pending and failure are separate from confirmation. Approval alone never creates a donation receipt. |
| Donation | The local submitted amount stays fixed while pending. Only explicit sample confirmation creates the example receipt. |
| Unavailable setup/data | Missing pool, network, balance, allowance or ledger state is explained without inventing a zero balance or a payment. |
| Holder | Sample authority, wallet, per-plot registry and expiry determine which local action can be previewed. Pending issue/revoke requests leave the recorded slot unchanged. |
| Co-op | Recorded holders and current farmers remain distinct. Expired/revoked slot assignments are not shown as current farmers. Paid/Held explanations retain their recorded meaning. |

Amounts use bigint arithmetic and decimal strings. No conversion through
JavaScript floating-point numbers is used for donation amounts. Sample event
history includes unavailable amounts where the recorded event does not provide
one; it does not reverse-engineer missing amounts from a display label.

## Validation

```sh
bun run frontend:check
bun run --cwd frontend test
bun run frontend:build
bun run --cwd frontend smoke:built
bun run storybook:build
bun run contracts:test
bun run typecheck
```

The built-server smoke checks all six preview routes and their assets with no
backend configured, alongside the existing legacy redirect and secret-isolation
checks. Storybook building does not execute its play assertions. Inspect the
donor approval/donation journey and the holder confirmation/cancellation flow in
the browser, including narrow screens and unavailable/expired states.

### Review evidence

- Frontend: 37 tests / 244 assertions; Astro and Solid checks clean across 84 files.
- Built server: all six preview routes, 16 referenced assets, legacy redirects
  and server-only environment checks passed.
- Storybook: 213 stories built. Chrome reported all ten new play checks
  successful: four donor, four holder and two co-op checks.
  The updated donor and holder stories also pass keyboard-focus assertions:
  phase changes retain an actionable position, while hydration and typing
  never take focus.
- Manual built-screen review: donor approval → donation → unavailable status →
  restored pending → sample receipt at 320px; holder cancellation and pending
  issue at 390px; co-op frame at 1440px. The 20,000 JPYC example donation reduced
  the sample 50,000 balance to 30,000 only after explicit confirmation.
- Contracts: 113 tests passed. Root typecheck retains the existing legacy
  `web/` TS2688 failure from ambient `@types/minimatch`; frontend and shared
  typechecks pass.

| Before | After | Why |
| --- | --- | --- |
| Three header links squeezed at 320px | Header wraps below the brand at narrow widths | All labels remain readable. |
| Desktop viewport could force two columns inside a phone frame | Organisms use their own container width | The phone frame keeps full-width cards. |

The local Astro development server selected React's production JSX dev runtime
and threw `_jsxDEV is not a function` during hydration. The same cache content
exists in older worktrees; this batch does not change Astro/Vite configuration
or dependencies. Browser acceptance above uses the built Node server and static
Storybook, where the islands work. The existing Storybook adapter cleanup
diagnostic (`transport was disconnected`) and large-bundle warning remain;
the build exits successfully and its browser play checks run.

## Integration still required

- #59: reviewed domain records and farm/plot relationships.
- #63: authenticated application actions, receipt handling and wallet providers.
- #69: authoritative contribution and relief reads with transaction evidence.
- #67: live-route parity, real identity/phone acceptance and server authorization.

The legacy holder implementation needs particular care during migration:
season-slot registries are per plot, and revocation uses
`unregister(uint256 anyId)` with the season labelhash on the plot's registry. This
preview does not repair or reuse the legacy transaction path. A connected wallet
or identity badge alone is not proof of authority, registration or eligibility.
