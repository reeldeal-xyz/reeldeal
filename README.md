# Umi

Umi is a fisheries and aquaculture relief fund for climate change, harmful algal blooms, and storm damages. With increasing uncertainty of conditions, fisherman and aquaculture operators are facing financial challenges to respond and adapt. This relief fund is designed to be funded by the sale of local goods, informed by real-time data from satellite imagery and existing oceanographic sensor networks, and transparent and timely release of funds to affected fisherman / aquaculture farms. The scale of the project is within Japan's Exclusive Economic Zone. 

## What is insurance / relief? 
Insurance is the regular collection of manageable funds before an event that catastrophically damages or negatively effects the business, so that the fund can pay out to affected beneficiaries in the case of the event. 

The policyholder pays the fund, the fund manages the money and pays the beneficiaries in the case of event. 

Types of insurance: 
1. Conventional, damages-based insurance: In this form of insurance, the policyholder pays the fund regularly. When event defined by the policy occurs (ex. car accident), the insurance company evaluates the damages and pays out depending on the value of damages. The beneficiary receives the fund after the damage is estimated. 
2. Parametric insurance: In this form of insurance the policyholder pays the fund regularly. When the event defined by the policy occurs, the payout is triggered by event thresholds rather than the damages that occured. For example, in wildfire scenario, the insurance payout is triggered by the property reaching excessive temperature (ex. above 200 deg C). Benefit is that this insurance does not require someone to assess damages and funds are released sooner, so can be used for responding to the triggered event. 

We are working with parametric insurance model, with thresholds crossed leading to release of funds. 

The thresholds are defined by the species and equipment used for farming, since each species (finfish, shellfish, seaweed) has different tolerances to threats, like heat stress, storm energy damage, toxins from harmful algal blooms. 

Avoiding the full "insurance" claim, since that comes with substantial legal burden. Instead, this is a relief fund that is a social good. 

Fund the relief fund through range of mechanisms:
1. Direct donations to the fund
2. Collecting fees from fisherman / aquaculture farmers 
3. Selling the local products (ReelDeal)

The data to inform whether the thresholds are crossed or not, comes from satellite imagery data (JAXA, NASA, ESA), deployed sensor networks with direct readings in-ocean, PDF reports from local government. The sensor networks and reports from local government is the ground truth, which we can calibrate / confidence on the satellite imagery derived results. 

We can understand / forecast / hindcast the occurrence of threshold triggering events from these data. This forms the spatial model for risk, model the distribution (where and how likely) thresholds are crossed (therefore cause damage to local fisherman, trigger payouts). 

## Repository Structure

- `contracts/` Foundry: `ReliefPool`, `HumanRegistry`
- `web/` Next.js: donor, co-op, holder screens, `/liff` farmer app, `/verify/[eventId]`, API routes
- `pipeline/` ocean data ingestion, indices, trigger signing, feed server (owner: Jay)
- `packages/shared/` Types, zod schemas, rules, addresses: the interface contract
- `docs/INTERFACE.md` Pipeline ↔ app contract. `docs/ARCHITECTURE.md` stack.

## Setup

```sh
git clone --recurse-submodules <repo> && cd eth-global-tokyo
cp .env.example .env
bun install
bun run contracts:build && bun run contracts:test
bun run typecheck
bun run pipeline   # feed on :8787
bun run dev        # web on :3000
```

Built at ETHGlobal Tokyo 2026 (Classic track), from 21:00 JST Friday 25 Sep.
