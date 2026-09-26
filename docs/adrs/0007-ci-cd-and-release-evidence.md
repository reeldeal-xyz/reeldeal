# 0007: Deploy from main and verify release evidence

Status: Proposed integrated deployment. Pipeline scaffold and CD workflow merged in #84.

## Context

The target runs FastAPI, Astro, PostgreSQL/PostGIS, and Caddy on EC2. PR #84
merged the pipeline scaffold, PR tests and main-only deployment workflow.
Deployment instructions document the repository's immutable OIDC subject claim.
At the earlier review, repository variables `AWS_DEPLOY_ROLE_ARN` and
`EC2_INSTANCE_ID` were absent; run `36223299342` passed tests and skipped
deployment. Those observations are historical. This source review has not
verified current AWS role/trust, instance access or a successful deployment.

## Decision

Test PRs; deploy approved main commits with service-specific rollout and serialized
deployment. Use GitHub OIDC and AWS SSM, with trust matching the current repository
and main ref: `repo:reeldeal-xyz/reeldeal:ref:refs/heads/main`. Coordinate IAM, schema
migrations, and application rollout with the named owners in #55/#71/#75.

## Consequences

The documented OIDC subject uses repository IDs; AWS trust and instance configuration still
need verification before relying on CD. No AWS change is implied by this ADR.
Health must expose the deployed revision and unimplemented/degraded modules.
Require real observed-data responses, receipt/balance evidence, persisted ledger,
LINE delivery, and restore/cutover/rollback proof before retiring `web/`.
Dotdog CI checks repository/spec drift and performs no deployment.

## Evidence

[Dotdog workflow](../../.github/workflows/dotdog.yml),
[#71](https://github.com/reeldeal-xyz/reeldeal/issues/71),
[#75](https://github.com/reeldeal-xyz/reeldeal/issues/75),
[reviewed workflow run](https://github.com/reeldeal-xyz/reeldeal/actions/runs/36223299342),
[current pipeline workflow](../../.github/workflows/deploy-pipeline.yml),
[current deployment instructions](../../pipeline/DEPLOY.md).
