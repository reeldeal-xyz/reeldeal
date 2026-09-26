# ETHGlobal form text (copy-paste)

Exact text for the ETHGlobal Tokyo project form. The long versions with links live in [SUBMISSION.md](SUBMISSION.md).

**Project name:** Reel Deal

**Category:** Data/Analytics

**Emoji:** 🐟

**Demo link:** https://web-production-746aa.up.railway.app

**Short description (≤100 chars):**

Parametric relief for aquaculture farmers, paid in JPYC when ocean risk crosses a threshold.

**Description (≥280 chars):**

Fishermen and aquaculture farmers on Japan's coast face shipping restrictions from harmful algal blooms, heat stress and storm damage — with no fast, low-friction way to get help. Conventional insurance needs a claims adjuster and takes months. Reel Deal is a donor-funded relief pool that instead pays out parametrically: when a public risk index (satellite sea-surface temperature, or a prefecture's own shipping-restriction bulletin) crosses a species-specific threshold, the pool pays JPYC directly to the farmer who holds that plot's season slot — no claims adjuster, no damage assessment, just a reproducible read of public data against a rule everyone can check in advance.

Identity is capped per real person with World ID (so one farmer can't claim as many plots as they can register), plot ownership and season-slot assignment live on ENSv2 (non-transferable, expiring names — a slot can't be sold or squatted), and farmers see everything — evidence, amount, payment status — through a LINE mini-app, because LINE is how Japanese fishing co-ops already communicate. Curvegrid MultiBaas indexes every on-chain event and drives the LINE push the moment a payment lands.

This is explicitly not insurance in the legal sense (see README.md's framing) and not a claim that a shipping restriction equals a specific farmer's measured loss — see Honest limitations in docs/SUBMISSION.md. It is a smaller, sharper claim: if a public index crosses a line, money moves, fast, to a name-checked human, with a public paper trail.

**How it's made (≥280 chars):**

Contracts (Solidity, Foundry, OpenZeppelin v5, Sepolia): ReliefPool v2 holds donated JPYC (18 decimals) and pays per plot when a signed Trigger is attested. A Trigger is an EIP-712 struct (zone, species, peril, tier, season, window, firedAt, index, threshold, tempC, dataHash, deadline) that needs 2-of-3 signatures (pipeline, co-op, science key). dataHash pins the sha256 of the public source (e.g. the Miyagi prefecture shipping-restriction PDF), and a /verify page recomputes the index in the browser. settle() pays the farmer who holds the plot's season slot, or holds the payout with a reason (UNVERIFIED, NO_FARMER, PLOT_EXPIRED, CAP, ZONE_MISMATCH) that can be claimed later. 139 Foundry tests, including a fuzz invariant (reserved == pending + held) and a viem-to-Solidity digest vector.

ENSv2 (Sepolia): umi.eth -> karakuwa.umi.eth -> p1213-001..015. Each plot has its own registry holding a non-transferable, expiring "2026" season slot issued by the licence holder. ReliefPool reads slot ownership on-chain through small ENS adapter contracts, so ownership is never copied off-chain.

World ID (IDKit v4): level 1 Selfie Check and level 2 (My Number Card / passport / Orb) proofs are verified server-side against the v4 API and bound to the farmer's wallet in a HumanRegistry that caps payout units per real person (3 vs 12).

LINE: a LIFF mini-app (LINE Login, on-device wallet, slot request, World ID, payout status, claim, gasless JPYC sends via EIP-3009 relayed by our keeper) plus Messaging API push cards. People without LINE sign in with Reown AppKit (WalletConnect) + SIWE into the same UI.

Curvegrid MultiBaas indexes every ReliefPool, HumanRegistry and JPYC event, powers the donor fund-activity dashboard, and fires an HMAC-verified webhook that sends the LINE "Paid" card, de-duplicated in Postgres.

TypeSafe Jev (via OpenRouter) is a typed decision model used as a safety gate: before attesting, it decides attest_now vs co_op_review with calibrated probabilities; low confidence escalates to a co-op approval card. It also routes farmers' LINE messages to fixed bilingual templates. It never writes text and never moves money.

Marketplace: SaleRouter atomically pays the seller and donates a share to the pool (donate(relief, "sale:<orderId>")) using server-signed EIP-712 quotes with replay and double-sale protection.

Data: a Python FastAPI risk API ingests JAXA SGLI/AMSR2 sea-surface temperature with byte-pinned inputs plus Miyagi toxin-ban bulletins; PostGIS stores plots and sea areas; an Astro + Storybook frontend hosts the operator HMI. The Next.js LINE app runs on Railway; the pipeline, database and Astro app on AWS EC2.

Notable hacks: the keeper falls back to self-signing when the feed has no signed trigger; a fork-mode e2e harness (bun run e2e) replays the whole payout path against a local fork of live Sepolia in ~75 s; and Trigger v2 bumps the EIP-712 domain so v1 signatures can never verify against the new pool.

**GitHub repository:** https://github.com/reeldeal-xyz/reeldeal (in the form, choose *Add GitHub Account* and grant ETHGlobal access to the  org)

**Prizes:** ENS (ENSv2), World (IDKit), Curvegrid (MultiBaas / RWA)
