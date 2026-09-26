# 0007: Deploy from main and verify release evidence

Status: Proposed integrated deployment. Pipeline implementation is in open PR #84.

## Context

The target runs FastAPI, Astro, PostgreSQL/PostGIS, and Caddy on EC2. At review,
PR #84 contains pipeline PR tests and main-only deployment; it is not merged.
The repository has moved from personal `ss251/reeldeal` to organization
`reeldeal-xyz/reeldeal`, so the old OIDC repository claim must be reviewed.
At review, GitHub Actions is enabled and repository admin access is available,
but repository variables `AWS_DEPLOY_ROLE_ARN` and `EC2_INSTANCE_ID` are absent.
Run `36223299342` passed its test job and skipped deployment. AWS-side role/trust
and instance access have not been verified by this documentation pass.

## Decision

Test PRs; deploy approved main commits with service-specific rollout and serialized
deployment. Use GitHub OIDC and AWS SSM, with trust matching the current repository
and main ref: `repo:reeldeal-xyz/reeldeal:ref:refs/heads/main`. Coordinate IAM, schema
migrations, and application rollout with the named owners in #55/#71/#75.

## Consequences

The old `ss251/reeldeal` claim in #75/PR #84 deployment documentation needs updating
before relying on CD after transfer; no AWS change is implied by this ADR.
Health must expose the deployed revision and unimplemented/degraded modules.
Require real observed-data responses, receipt/balance evidence, persisted ledger,
LINE delivery, and restore/cutover/rollback proof before retiring `web/`.
Dotdog CI checks repository/spec drift and performs no deployment.

## Evidence

[Dotdog workflow](../../.github/workflows/dotdog.yml),
[#71](https://github.com/reeldeal-xyz/reeldeal/issues/71),
[#75](https://github.com/reeldeal-xyz/reeldeal/issues/75),
[reviewed workflow run](https://github.com/reeldeal-xyz/reeldeal/actions/runs/36223299342),
[pipeline workflow at review](https://github.com/reeldeal-xyz/reeldeal/blob/8d3ef636f336d00f1091336009462a828513a4e1/.github/workflows/deploy-pipeline.yml),
[deployment instructions at review](https://github.com/reeldeal-xyz/reeldeal/blob/8d3ef636f336d00f1091336009462a828513a4e1/pipeline/DEPLOY.md).
