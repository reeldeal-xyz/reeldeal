# Aquaculture relief: HMI contribution

Contribution handoff for Justin (`logohere`), within Superposition
[#54](https://github.com/reeldeal-xyz/reeldeal/issues/54). Reviewed against main
`e342553` on 2026-09-26. Issues own acceptance and current status; this document
connects the contribution, research and product language. It does not declare
the integrated application delivered. Production implementation was requested
after the initial planning handoff; acceptance remains in the linked tickets.

## Tickets and ownership

| Work | Ticket | Integration |
|---|---|---|
| Focused contribution plan | [#32](https://github.com/reeldeal-xyz/reeldeal/issues/32) | Team interfaces remain under #55 |
| Source and rule evidence review | [#36](https://github.com/reeldeal-xyz/reeldeal/issues/36) | Jay owns ingestion/models; #60/#64 own consumer validation/evaluation |
| My Farm screen, copy and UX acceptance | [#40](https://github.com/reeldeal-xyz/reeldeal/issues/40) | Eric owns Astro routes #67/#68; Sailesh owns identity/wallet/signing |
| Exact-input and chain provenance | [#46](https://github.com/reeldeal-xyz/reeldeal/issues/46) → [#68](https://github.com/reeldeal-xyz/reeldeal/issues/68) | #46 was consolidated, not implemented; #68 retains hash/deployment/year checks |
| Species responses and Japan-focused 2D/3D | [#47](https://github.com/reeldeal-xyz/reeldeal/issues/47) | Implementation requested; supported data/models and operator acceptance remain release gates |

Seafood illustrations are already merged through
[#93](https://github.com/reeldeal-xyz/reeldeal/pull/93) and integrated by
[#99](https://github.com/reeldeal-xyz/reeldeal/pull/99). Reuse the existing assets
in #66. Dotdog and ADRs landed through #85/#87; follow the
[map and spec workflow](REPO-MAP.md) for subsequent changes.

## One application, two journeys

Use one LINE LIFF entry and the same Astro application in Safari. **My Farm**
connects a registered plot, accepted environmental evidence and the relief
outcome. **Market** supports purchasing and the team's contribution flow.
Preserve shared **Wallet** access, pinned identity, recovery and read-only states.
General JPYC transfers are not automatically relief payments.

Extend `frontend/src/components/organisms/farmer-relief` and `event-verification`
through #67/#68, coordinating with Eric's #100. #59 supplies canonical records,
#60 validates responses, #64 evaluates/signs and #69 supplies the ledger.
World ID verifies humanity; plot association and policy determine entitlement.

On phones, show plot → evidence → relief/next action. Desktop may expand the
map and role-gated co-op controls. Keep the initial map around Kesennuma/Karakuwa,
with a usable plot list, numeric units, observation time, missingness and source
support. Mark synthetic geometry. Species selection changes interpretation;
environmental measurements remain species-agnostic. Browsing and time scrubbing
must remain read-only.

## Proposed demonstration

Community funding → registered scallop plot → reviewed shipping-restriction
evidence → configured allocation → confirmed payment → LINE update.

Start with one historical Karakuwa episode and direct donations. This narrows
Justin's contribution; #54 still owns the team's sale-to-relief acceptance.
Jay's accepted heat results use the same evidence view. Do not make his heat
work wait for the proposed restriction replay or introduce another risk engine.
Source limitations and deferred science are in the [research notes](research/aquaculture-evidence.md).

Merged #112 implements JAXA ingestion and heat responses. Q10 is decided:
SGLI night → SGLI day → AMSR2 night → null. Keep `source.product`, extraction
distance and coverage beside results; the coarser offshore fallback is material.
`REFERENCE_FIRES` now follows the JAXA snapshot, not the former MUR dates.
See [pipeline conventions](../pipeline/README.md) and [interface regression](INTERFACE.md).
HAB chlorophyll layers exist; restriction indices remain #80.

Merged #113 supplies the LIFF Wallet tab; its real-phone integration still needs
proof. Merged #114/#115 add the DB service, interim inventory and app-state
stores; Astro integration still needs acceptance. #100 remains an open UI preview.
Merged #117 implements Trigger v2 and its ABI/domain changes; #118 records the
new ReliefPool address, deployment block and broadcast receipts. #55 still owns
verification of live enrollment/funding and MultiBaas configuration. Archived
receipts do not replace the integrated payment/LINE acceptance check.

[PR #119](https://github.com/reeldeal-xyz/reeldeal/pull/119) begins implementation
with the bounded Astro heat-data endpoint and runtime validation. Python-produced
conformance fixtures, live evidence, UI integration and payment/LINE acceptance
remain open; this increment does not close #40 or #68.

## Product copy

> **Community-funded relief payments for aquaculture farmers.**
>
> Help support growers affected by shipping restrictions. See the evidence,
> available funds and confirmed payments.

Actions: **Support the fund** · **Check my relief** · **View payment proof**.
Keep **Historical replay · Sepolia test funds** visible. Beside amounts:
**Assistance depends on eligibility and available funds.** Adapt the
shipping-restriction sentence when demonstrating a heat event.

| UI language | Required evidence |
|---|---|
| Payment confirmed | Confirmed, nonzero `Paid`/`Claimed` transfer |
| Payment on hold | Actual `Held` reason and available next action |
| Claim window ended | `Swept`; reserve released, no outgoing payment |
| Rule met / awaiting settlement | Accepted evaluator result, not a payment |
| Evidence unavailable / no allocation | Explicit missing evidence or allocation result |

Do not promise guaranteed/instant payments, compensation for measured losses,
or that a purchase is earmarked for a named farmer. At the same block,
available = balance − reserved; reserved includes pending and held amounts.
Retain JPYC's 18-decimal precision and configured allocation/per-human caps.

Marketing references from recent ETHGlobal finalists:
[OpenBook](https://ethglobal.com/showcase/openbook-8ngw6) names a specific service
and outcome; [Happy Hour](https://ethglobal.com/showcase/happy-hour-v3o03) leads
with a familiar action and reward; [TARE](https://ethglobal.com/showcase/tare-ozced)
makes its measurement inspectable. The useful pattern is one clear problem,
mechanism and verifiable result. This is a writing inference, not evidence of
why judges selected them; do not copy slogans or unsupported market claims.

## Delivery evidence

#36 needs one accepted producer response and a reproducible evaluator result.
#40 needs responsive components and tested failure states inside #67/#68.
#68 resolves evidence using chain, deployment, receipt/log and exact inputs,
returning missing/ambiguous/mismatch rather than the first event across years.
#70/#71 own the integrated proof: one confirmed nonzero payment and one LINE
update, plus held funds, insufficient funds, unavailable evidence and duplicate
delivery. Preserve real-phone/Safari, Japanese/English, keyboard and zoom checks.

Reuse Curvegrid/MultiBaas under #23/#69 for event history and notifications,
with deployment filtering, reconciliation and durable deduplication. Component
stories, archived transactions and merged code do not establish live end-to-end
delivery. Research curves and scenarios cannot authorize relief payments.
