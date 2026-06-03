# Deploying to Google Cloud Run

A concrete recipe for hosting the server on [Cloud Run](https://cloud.google.com/run). The server
is just a container, so adapt these steps to any platform.

## Prerequisites

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
```

## 1. Store the Revolut credentials in Secret Manager

Keep the private key and refresh token out of the image and out of source control:

```bash
gcloud secrets create revolut-private-key --replication-policy=automatic
gcloud secrets versions add revolut-private-key --data-file=./privatecert.pem

gcloud secrets create revolut-refresh-token --replication-policy=automatic
printf '%s' "YOUR_REFRESH_TOKEN" | gcloud secrets versions add revolut-refresh-token --data-file=-
```

Grant the Cloud Run runtime service account access (default is the compute SA):

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT --format='value(projectNumber)')
for S in revolut-private-key revolut-refresh-token; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 2. Deploy

Cloud Build builds the `Dockerfile` from source. Pick **one** inbound-auth mode for `/mcp`.

**OAuth (recommended — enables the custom-connector UI / web / ChatGPT):**

```bash
gcloud run deploy revolut-business-mcp \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --max-instances=1 \
  --set-secrets REVOLUT_PRIVATE_KEY=revolut-private-key:latest,REVOLUT_REFRESH_TOKEN=revolut-refresh-token:latest \
  --set-env-vars REVOLUT_CLIENT_ID=YOUR_CLIENT_ID,REVOLUT_JWT_ISSUER=YOUR_DOMAIN,REVOLUT_ENVIRONMENT=production,OAUTH_ISSUER=https://YOUR-TENANT.example,SERVER_URL=https://YOUR-PUBLIC-URL,OAUTH_RESOURCE=https://YOUR-PUBLIC-URL,OAUTH_ALLOWED_EMAIL_DOMAINS=example.com
```

**Static bearer token (Claude Code / Desktop only):**

```bash
gcloud secrets create mcp-auth-token --replication-policy=automatic
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add mcp-auth-token --data-file=-
gcloud run deploy revolut-business-mcp --source . --region europe-west1 --allow-unauthenticated --max-instances=1 \
  --set-secrets REVOLUT_PRIVATE_KEY=revolut-private-key:latest,REVOLUT_REFRESH_TOKEN=revolut-refresh-token:latest,MCP_AUTH_TOKEN=mcp-auth-token:latest \
  --set-env-vars REVOLUT_CLIENT_ID=YOUR_CLIENT_ID,REVOLUT_JWT_ISSUER=YOUR_DOMAIN,REVOLUT_ENVIRONMENT=production
```

Enable money movement only when you're ready: add `REVOLUT_ENABLE_PAYMENTS=true` to the env vars
(and make sure your authorization included the `PAY` scope).

### Notes / Cloud-Run-specific gotchas

- `--allow-unauthenticated` is safe — the app's own auth middleware gates `/mcp`. (Cloud Run's IAM
  gate can't carry the OAuth/bearer flow MCP clients use.)
- **`--max-instances=1`** keeps the per-process ~1 req/s rate limiter accurate.
- Health check path is **`/status`**, not `/healthz` — Google Front End intercepts `/healthz`.
- Cloud Run injects `PORT`; the server honors it.
- **Refresh token:** Revolut does **not** rotate it on refresh (verified in sandbox), so the
  env-provided `REVOLUT_REFRESH_TOKEN` keeps working across restarts — no volume or warm instance
  needed. Re-run `npm run authorize` at most every ~90 days.

## Production: connecting a real Revolut account

Sandbox needs neither of these; production needs both:

**1. A paid plan.** Revolut Business API access requires the **Grow** plan (or above).

**2. A static outbound IP.** Production enforces an **IP allow-list** (configured on your API
certificate), and Cloud Run's egress IP is dynamic by default. Route egress through Cloud NAT with
a reserved static IP, then whitelist that IP in Revolut:

```bash
REGION=europe-west1
# 1) Reserve a static IP — this is the address you whitelist in Revolut
gcloud compute addresses create revolut-nat-ip --region=$REGION
gcloud compute addresses describe revolut-nat-ip --region=$REGION --format='value(address)'

# 2) VPC + subnet + Cloud Router + NAT pinned to that IP
gcloud compute networks create revolut-vpc --subnet-mode=custom
gcloud compute networks subnets create revolut-subnet \
  --network=revolut-vpc --region=$REGION --range=10.8.0.0/28
gcloud compute routers create revolut-router --network=revolut-vpc --region=$REGION
gcloud compute routers nats create revolut-nat --router=revolut-router --region=$REGION \
  --nat-custom-subnet-ip-ranges=revolut-subnet --nat-external-ip-pool=revolut-nat-ip

# 3) Deploy with Direct VPC egress so ALL outbound traffic goes subnet → NAT → static IP
gcloud run deploy revolut-business-mcp --source . --region=$REGION \
  --allow-unauthenticated --max-instances=1 \
  --network=revolut-vpc --subnet=revolut-subnet --vpc-egress=all-traffic \
  --set-secrets REVOLUT_PRIVATE_KEY=revolut-private-key:latest,REVOLUT_REFRESH_TOKEN=revolut-refresh-token:latest \
  --set-env-vars REVOLUT_ENVIRONMENT=production,REVOLUT_CLIENT_ID=...,REVOLUT_JWT_ISSUER=...,OAUTH_ISSUER=...,SERVER_URL=...,OAUTH_RESOURCE=...,OAUTH_VERIFY_AUDIENCE=true
```

Then: add the reserved IP under **Revolut Business → APIs → (your certificate) → Production IP
whitelist**; create the production certificate/Client ID and run `npm run authorize` (production —
add the `PAY` scope if you'll move money) for a production refresh token; keep
`REVOLUT_ENABLE_PAYMENTS=false` until you intend to move real money; and set
`OAUTH_VERIFY_AUDIENCE=true` once your OAuth provider advertises a Resource Indicator for the server.

## 3. (Optional) Custom domain

```bash
gcloud beta run domain-mappings create --service=revolut-business-mcp --domain=revolut.example.com --region=europe-west1
gcloud beta run domain-mappings describe --domain=revolut.example.com --region=europe-west1 --format="json(status.resourceRecords)"
```

Add the returned `CNAME` (to `ghs.googlehosted.com.`) at your DNS provider; Google provisions a
managed TLS certificate (usually minutes).

## 4. Connect

Point your MCP client at `https://YOUR-PUBLIC-URL/mcp`. For OAuth, add it as a custom connector in
the Claude app; for a static token, see the README's Claude Code/Desktop snippet.
