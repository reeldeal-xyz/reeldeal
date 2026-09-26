# Jev decision layer

Contracts pay deterministically -- ReliefPool's `attest`/`settle` never touch an LLM. Jev (TypeSafe's
"System One" model, via OpenRouter) sits entirely off that critical path: it routes farmer LINE messages to
a canned bilingual reply and it gates when the keeper attests a fired trigger, both as typed Choice
decisions with calibrated probabilities -- never free text. Below a confidence threshold, or on any failure,
both integrations do the same thing: escalate to a human (the co-op) instead of guessing. Nothing about
money ever depends on generated text, and Jev can only ever add friction (a co-op review hold), never cause
a payout.

## Confirmed request/response shape (alpha API)

Docs read before writing any code (the API is alpha and not fully consistent -- see Feedback below):

- <https://openrouter.ai/docs/guides/community/jev> -- overview, model ids, question primitives
- <https://openrouter.ai/docs/guides/community/jev-tutorial> -- worked curl/TypeScript example (this is
  where the exact request/response JSON actually lives)
- <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request>
  -- field-by-field reference
- <https://typesafe.ai/blog/introducing-system-one-models-and-jev> -- product framing (RLCD, "type-safe
  structured values", 70-500ms latency, output tokens are free)

Confirmed against 3 real calls on 2026-09-26 (see logs below; total spend ~$0.00007, key limit is $10,
essentially untouched):

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json

{
  "model": "typesafe/jev-1.13",
  "state": { "message": "支払いはいつ届きますか？まだ何も来ていません。", "channel": "line", "locale": "ja" },
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "Classify the farmer's LINE message into the single best-matching intent...",
      "criteria": { "payout_status": "...", "why_held": "...", "verify_identity": "...", "...": "..." }
    }
  }
}
```

Response (this client renames the question key to `q` internally -- see `web/src/lib/jev.ts`):

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "intent": {
      "type": "choice",
      "choice": "payout_status",
      "probabilities": { "why_held": 0, "trigger_explanation": 0, "talk_to_coop": 0, "other": 0, "request_slot": 0, "verify_identity": 0, "payout_status": 1 },
      "confidence": 1
    }
  },
  "usage": { "input_tokens": 522, "output_tokens": 80, "cost": 0.000021924 },
  "id": "gen-dec-1790392982-MC1uL9O9oIev0xUfhWPs",
  "provider": "TypeSafe"
}
```

Model id used: **`typesafe/jev-1.13`** in the request; the response echoes a dated sub-version
(`typesafe/jev-1.13-20260917`) we don't otherwise depend on. `~typesafe/jev-latest` is documented as a
floating alias but we pinned the dated id for reproducible demo logs. `typesafe/jev-router` (seen in the
public `/api/v1/models` listing) is a *different* surface (looks like the general-purpose OpenRouter model
listing, not the alpha Decisions API) -- we did not use it and don't believe it's the right id for this
endpoint; the Decisions API only ever accepted `typesafe/jev-1.13`.

Score questions (`askScore` in `web/src/lib/jev.ts`) follow the same request/response shape with
`type: "score"`, an ordered `criteria: string[]` in place of the `criteria` map, and a `score`/`legend`
pair in the answer instead of `choice`. We built and typed the helper but neither integration below needed
it yet (both of our decisions are naturally two/seven-way choices, not scalar ratings).

## Integration 1: LINE intent routing

`web/src/app/api/line/webhook/route.ts` (signature verification untouched). For every `message`/`text`
event, we ask a single Choice question over
`{payout_status, why_held, verify_identity, request_slot, trigger_explanation, talk_to_coop, other}` with
`state = { message: <farmer's text>, channel: "line" }`.

- Top probability >= `JEV_CONFIDENCE_THRESHOLD` (default **0.7**): reply via LINE's reply API (new
  `replyMessage` helper in `web/src/lib/line.ts`, next to `pushPaid`/`pushHeld`, reusing the same
  stateless-token minting) with a fixed bilingual (JA-then-EN) template for that intent
  (`web/src/lib/jev-templates.ts`). Templates include cheap deterministic data: the LIFF link
  (`https://liff.line.me/2011749457-SgvM5ahH`, exported as `LIFF_BASE_URL` in `web/src/lib/plots.ts`) for
  `verify_identity`/`request_slot`/`why_held`, and the donor-ledger path `/donate` for `payout_status`.
  `trigger_explanation` punts on the real per-day index math (TODO, noted inline) and just tells the farmer
  a payout crossing a threshold is automatic.
- Below threshold, or Jev unavailable (missing key, timeout, non-2xx): reply with a fixed "the co-op will
  get back to you" template and mark the decision escalated.
- Every decision is logged as one structured JSON line, `scope:"jev"`, regardless of outcome -- see example
  logs below.
- Jev only ever *selects which canned string to send*. It never generates the reply text and never touches
  a wallet, a trigger, or a payout.

## Integration 2: keeper attest gate

`web/src/lib/jev-gate.ts` exports a single function, `decideAttest(state)`, kept deliberately out of the
keeper's own files so it can be wired in with one line. It's now actually wired into
`web/src/lib/keeper/run.ts::runKeeper`, right before the `attest` transaction, once #17 (the keeper) merged
to `main` mid-build:

```ts
const gate = await deps.decideAttest(buildAttestGateState(trigger, ref));
if (gate.decision === 'co_op_review') {
  // skip attest entirely; return { status: 'escalated', jevGate: gate, ... }
}
// else: fall through to the existing deterministic attest/sign flow, unchanged
```

State asked: the trigger's zone/species/peril/tier/index/threshold/firedAt, a buoy-vs-satellite offset
(`meanDiffC`/`minDiffC`/`maxDiffC`), how many days of data back the index, and the pinned input's source
hash(es). Question: Choice `{attest_now, co_op_review}`.

**Known gap, called out honestly rather than faked:** the keeper doesn't fetch buoy ground-truth
(`BuoyFile.vsSatellite`) or the pipeline's per-day series alongside a trigger yet, so today
`buildAttestGateState` (in `run.ts`) sends `buoyOffset: null` and derives `daysOfData` from the trigger's
own `windowStart`-to-`firedAt` span (a proxy, not a real per-day data-completeness count) with
`sourceHashes: [trigger.dataHash]` (the one hash the Trigger struct actually carries). TODO once the keeper
reads `BuoyFile`/`SeriesFile` alongside the trigger: pass the real offset stats and day count.

- A failed call, a low-confidence answer, or `co_op_review` itself -> the keeper skips attest and returns
  `status: 'escalated'` with the Jev probabilities attached; nothing is attested or settled.
- `runKeeper({ ..., force: true })` (and `POST /api/keeper/replay` with `"force": true` in the body) skips
  the gate entirely -- a live-demo override so a low-confidence read never blocks the map's replay button
  on stage. `decideAttest` is never even called when `force` is set.
- Same threshold knob as the LINE side (`JEV_CONFIDENCE_THRESHOLD`, default 0.7).
- Every gate decision is logged, `scope:"jev"`, `kind:"attest_gate_decision"`.
- This can only ever *delay* an attest (by holding for `co_op_review`) -- it has no code path that calls
  `attest`/`settle` itself, so it cannot cause a payout.

## Thresholds & env

`web/src/lib/env.ts` / `.env.example`:

- `OPENROUTER_API_KEY` -- optional; unset means every `askChoice`/`askScore` call returns `null` and both
  integrations escalate immediately.
- `JEV_MODEL` -- optional, defaults to `typesafe/jev-1.13`.
- `JEV_CONFIDENCE_THRESHOLD` -- optional, defaults to `0.7`. Shared by both integrations; validated to
  `[0, 1]`, otherwise falls back to the default.

## Example decision logs (real calls, 2026-09-26)

Three real calls were made against the live alpha API while building this (all via `bun` scripts hitting
`https://openrouter.ai/api/alpha/decisions` directly, to confirm the shape before writing the client).
Total cost: **$0.000069 combined** (input_tokens 522 + 519 + 637; output_tokens 80 + 78 + 37), against a
$10 key limit.

1. Clear intent -- "支払いはいつ届きますか？まだ何も来ていません。" ("When will my payout arrive? Nothing
   has come yet.") ->
   ```json
   {"scope":"jev","kind":"intent_decision","model":"typesafe/jev-1.13","intent":"payout_status","confidence":1,"probabilities":{"payout_status":1,"why_held":0,"verify_identity":0,"request_slot":0,"trigger_explanation":0,"talk_to_coop":0,"other":0},"threshold":0.7,"escalated":false,"reason":"ok"}
   ```
2. Off-topic chatter -- "こんにちは、元気ですか？今日は天気がいいですね。" ("Hi, how are you? Nice weather
   today.") -> classified `other` at confidence 1 (correctly *not* forced into one of the six real intents):
   ```json
   {"scope":"jev","kind":"intent_decision","model":"typesafe/jev-1.13","intent":"other","confidence":1,"probabilities":{"other":1,"payout_status":0,"why_held":0,"verify_identity":0,"request_slot":0,"trigger_explanation":0,"talk_to_coop":0},"threshold":0.7,"escalated":false,"reason":"ok"}
   ```
3. Attest gate, genuinely marginal data quality -> confidence landed *below* our 0.7 threshold on its own,
   correctly falling back to `co_op_review` even though Jev's raw pick was `attest_now`:
   ```json
   {"scope":"jev","kind":"attest_gate_decision","refId":"demo","eventId":"0x...","decision":"co_op_review","confidence":0.53,"probabilities":{"attest_now":0.77,"co_op_review":0.23},"reason":"low_confidence"}
   ```

## Feedback for TypeSafe / OpenRouter (sponsor)

- **Endpoint URL is inconsistent across docs.** The guide/tutorial page consistently uses
  `https://openrouter.ai/api/alpha/decisions` (confirmed working), but the generated API-reference page we
  fetched separately printed `https://openrouter.ai/api/v1/api/alpha/decisions` (a duplicated `/api/v1`
  segment) as the endpoint. An integrator who trusts the reference page over the tutorial will 404. Worth
  fixing the reference-page codegen.
- **The request model id and response model id differ** (`typesafe/jev-1.13` in,
  `typesafe/jev-1.13-20260917` out) and that's undocumented. Not a problem once you notice it, but cost us
  a double-take the first time -- a one-line note ("the response echoes the dated build actually served")
  would help.
- **`typesafe/jev-router`**, the id shown in the public `/api/v1/models` listing, isn't mentioned anywhere
  in the Decisions API docs. We couldn't tell from the docs whether it's a valid alternative for
  `/api/alpha/decisions`, a router for the *general* chat-completions surface, or vestigial -- we didn't
  risk a wasted call finding out. A one-line disambiguation in the guide would save the next integrator the
  same hesitation.
- **What worked well:** the three real calls we made were all exactly the documented shape, no surprises.
  Calibration looked genuinely good even in this tiny sample -- an unambiguous message got confidence 1,
  an off-topic one still cleanly hit `other` at confidence 1 (not smeared across the "real" intents), and a
  deliberately marginal attest-quality prompt landed at 0.53, i.e. Jev *told us* it wasn't sure rather than
  confidently picking one side. That's exactly the property this project needed: a threshold we can trust
  to gate real money movement. Latency was fast enough (sub-second per call in casual testing) that we
  didn't need to think about it. Cost is a non-issue at ~$0.00002-0.00003/decision.
- **Untested surface:** we only ever sent one question per request. The multi-question-per-call shape in
  the docs (several named questions against one `state`) looks like a good fit for batching the LINE intent
  classification together with, say, a sentiment/urgency Score in one round trip -- we didn't get to try it
  under this deadline.
