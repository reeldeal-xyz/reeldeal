# Deploying the pipeline API to AWS

Hackathon setup: **one EC2 instance in Tokyo running Docker Compose**, with Caddy in front for automatic HTTPS. The planned daily build job will run on the same box via cron once its CLI exists (§6). No load balancer, ECS or Lambda.

```
browser / app ──https──▶ Caddy :443 ──▶ api (uvicorn, pipeline.api:app) :8787
                                              │
                         ./data  ./out  ◀─────┘  (bind mounts, survive rebuilds)
                         s3://<bucket>/<module>/  (via the instance role)
cron ──▶ docker compose run --rm api pipeline … build   (daily layers, README §9)
```

Files, all in `pipeline/`:

| File | Purpose |
|---|---|
| `Dockerfile` | `python:3.12-slim` + uv; installs from `uv.lock` without dev deps; runs uvicorn on :8787 as a non-root user (uid 1000) |
| `docker-compose.yml` | `api` (not exposed publicly) + `caddy` (ports 80/443) |
| `Caddyfile` | Reverse proxy to `api:8787` for `$SITE_ADDRESS`; gets a Let's Encrypt certificate |
| `.env.example` | Template for `pipeline/.env` on the server (hostname, Copernicus login, bucket) |

## 1. Local check (optional)

```sh
cd pipeline
mkdir -p data out
docker compose up -d --build
curl -k https://localhost/health     # Caddy's local CA, hence -k
docker compose down
```

With `SITE_ADDRESS` unset, Caddy serves `https://localhost` with a self-signed certificate. Routes that aren't written yet return `501`.

## 2. AWS resources (one-time, region `ap-northeast-1`)

1. **S3 bucket** for layers and pinned inputs, e.g. `eth-global-tokyo-pipeline`. Block all public access.
2. **IAM role** `pipeline-ec2` (trusted entity: EC2) with an inline policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::eth-global-tokyo-pipeline" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::eth-global-tokyo-pipeline/*" }
     ]
   }
   ```
   Code in the container picks up these credentials from instance metadata. No access keys anywhere.
3. **Security group** `pipeline-web`: inbound TCP 80 and 443 from `0.0.0.0/0` (80 is needed for the Let's Encrypt challenge), and TCP 22 **from your IP only**.
4. **EC2 instance:**
   - AMI: Ubuntu Server 24.04 LTS (its `ubuntu` user is uid 1000, matching the container user, so bind mounts are writable).
   - Type: `t3.medium` (2 vCPU / 4 GB). Go up to `t3.large` when xarray builds need more memory.
   - Storage: 30 GB gp3.
   - IAM instance profile: `pipeline-ec2`. Security group: `pipeline-web`. Your key pair.
5. **Elastic IP:** allocate one and associate it with the instance so the address (and hostname) survives stop/start.

**Hostname:** with no domain, use sslip.io, which resolves `13-115-1-2.sslip.io` to `13.115.1.2`. With a domain, point an `A` record at the Elastic IP and use that instead.

## 3. Server setup (one-time)

```sh
ssh ubuntu@<elastic-ip>

# Docker Engine + compose + buildx
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # log back in for the group to apply

ssh ubuntu@<elastic-ip>
git clone -b main <repo-url> reeldeal   # main is the deployed branch; private repo: use a read-only deploy key
cd reeldeal/pipeline
mkdir -p data out                        # create before compose, or Docker creates them as root

cp .env.example .env
nano .env                                # set SITE_ADDRESS=<ip-with-dashes>.sslip.io, Copernicus login, bucket

docker compose up -d --build
docker compose logs -f caddy             # wait for "certificate obtained successfully"
curl https://<SITE_ADDRESS>/health
```

The web app points at `https://<SITE_ADDRESS>`. CORS is open (`api.py`), so no extra config is needed. Interactive docs are at `/docs`.

## 4. Deploying changes

```sh
ssh ubuntu@<elastic-ip>
cd reeldeal/pipeline
git checkout main && git pull --ff-only
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build   # rebuilds api; Caddy and its certificate stay
docker image prune -f
```

Rebuilds after code-only changes take seconds, because dependencies are a separate cached layer. `data/`, `out/` and Caddy's certificates are volumes and are not touched.

## 5. Automatic deploys from GitHub

`.github/workflows/deploy-pipeline.yml` is continuous deployment from **`main`**. Pipeline work goes on an issue branch and reaches `main` through a PR.

- **Pull requests into `main`** that touch `pipeline/`: only the **test** job runs, so a PR with failing tests shows red before merge.
- **Every push to `main`** that touches `pipeline/` (i.e. every merge), or a manual run on `main` (Actions → deploy-pipeline → Run workflow):
  1. **test:** `uv sync --locked && uv run pytest`. A failing test stops the deploy.
  2. **deploy:** assumes an AWS role via GitHub OIDC, then uses **SSM Run Command** to run, on the instance as `ubuntu`:
     - `git checkout -f -B main <pushed sha>`
     - `GIT_SHA=<pushed sha> docker compose up -d --build --wait`. `--wait` fails the job if the API never becomes healthy.
     - A check that `/health` reports `"commit": "<pushed sha>"`, so a stale container can't pass.

     The command's output shows in the Actions log. The deploy job never runs on PRs or other branches.

`/health` always answers 200 while the process is up. Its `status` is `ok` only when every route is implemented. It is `degraded` while some routes are still `@stub` (HTTP 501) and `unimplemented` when all of them are, with per-module `routes: {implemented, total}` counts.

Why SSM and not SSH: port 22 is open only to your IP, and GitHub's runners use changing IPs. SSM needs no inbound port, and OIDC means no AWS keys or SSH keys are stored in GitHub.

One-time setup:

1. **Let SSM manage the instance.** Attach the AWS managed policy `AmazonSSMManagedInstanceCore` to the `pipeline-ec2` role. The SSM agent is preinstalled on Ubuntu 24.04 AMIs. After a few minutes, check that the instance is listed:
   ```sh
   aws ssm describe-instance-information --region ap-northeast-1 \
     --query 'InstanceInformationList[].[InstanceId,PingStatus]' --output text
   ```
   If it doesn't show up, run `sudo snap restart amazon-ssm-agent` on the instance.
2. **Add GitHub as an identity provider** (once per AWS account): IAM → Identity providers → Add provider → OpenID Connect, provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
3. **Create the deploy role** `pipeline-github-deploy`:
   - Trust policy (only runs on the `main` branch of this repo can assume it):
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{
         "Effect": "Allow",
         "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:reeldeal-xyz@334096584/reeldeal@1387452000:ref:refs/heads/main"
           }
         }
       }]
     }
     ```
     This repo uses GitHub's **immutable subject claims**, so the token's `sub` names the owner and repo by numeric ID (`reeldeal-xyz@334096584/reeldeal@1387452000`) rather than by name. That survives renames and transfers. A name-only `sub` such as `repo:reeldeal-xyz/reeldeal:…` never matches, and AWS answers "Not authorized to perform sts:AssumeRoleWithWebIdentity". To check the current prefix: `gh api repos/reeldeal-xyz/reeldeal/actions/oidc/customization/sub` (`sub_claim_prefix`). Manual runs (`workflow_dispatch`) also only work from `main`; the workflow skips the deploy job anywhere else. To deploy another branch too, add it to `on.push.branches` in the workflow, relax the job's `if:`, and add its `sub` to this condition (it accepts a list).
   - Permissions (inline policy; it can run commands on this one instance, nothing else):
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         { "Effect": "Allow", "Action": "ssm:SendCommand", "Resource": [
             "arn:aws:ec2:ap-northeast-1:<account-id>:instance/<instance-id>",
             "arn:aws:ssm:ap-northeast-1::document/AWS-RunShellScript" ] },
         { "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*" }
       ]
     }
     ```
4. **Make sure the server can fetch on its own.** The clone in step 3 must use a deploy key (or be public), so `git fetch` works without you. Test it on the instance: `cd ~/reeldeal && git fetch origin main`. If the instance was set up from the old `pipeline` branch, switch it once: `git fetch origin main && git checkout -f -B main origin/main`. If its `origin` still points at an old name, update it: `git remote set-url origin git@github.com:reeldeal-xyz/reeldeal.git` (GitHub redirects renames and transfers, but a deploy key is tied to the repo).
5. **Add the repo variables** in GitHub → Settings → Secrets and variables → Actions → **Variables** (not secrets; neither value is sensitive):
   - `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::<account-id>:role/pipeline-github-deploy`
   - `EC2_INSTANCE_ID` = `i-…`

Notes:
- The deploy resets the server's checkout to the pushed commit, so **don't edit tracked files on the server**; they will be overwritten. Untracked and ignored files (`.env`, `data/`, `out/`) are kept.
- Deploys are serialized (`concurrency: deploy-pipeline` on the deploy job), so two quick merges deploy in order.
- A manual deploy (§4) still works: `git checkout main && git pull --ff-only && GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build`.

## 6. Daily build job

> The `pipeline` CLI (README §9, `cli.py`) isn't written yet. Once it exists and is registered under `[project.scripts]`, add this crontab entry (`crontab -e` as `ubuntu`):

```cron
# 03:00 JST (18:00 UTC; the instance clock is UTC) daily: build all modules' layers for the JST date
0 18 * * * cd /home/ubuntu/reeldeal/pipeline && docker compose run --rm api pipeline all build --date "$(TZ=Asia/Tokyo date +\%F)" >> /home/ubuntu/pipeline-cron.log 2>&1
```

`docker compose run` uses the same image, `.env` and volumes as the API, so layers written to `out/` are served immediately.

**Before the demo,** build the demo region ahead of time (`pipeline all --season 2025 --region miyagi`) so the demo doesn't depend on JAXA or Copernicus being up that day.

## 7. Operating

```sh
docker compose ps                        # both services up, api "healthy"
docker compose logs -f api               # request logs and tracebacks
docker compose restart api
docker compose exec api sh               # shell inside the container
```

- The API has a Docker healthcheck on `/health`, and both services have `restart: unless-stopped`, so they come back after a crash or reboot.
- Serving one module alone (`pipeline-serve --module heat`) isn't wired into compose. If you need it, override `command:` for `api`.

## 8. Cost and teardown

`t3.medium` on-demand in Tokyo is roughly US$1.30/day, plus EBS and S3 (small). An Elastic IP is billed whether or not it's attached. After the hackathon: terminate the instance, **release the Elastic IP**, and empty and delete the bucket if the data isn't needed.
