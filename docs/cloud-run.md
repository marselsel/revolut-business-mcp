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
- **Refresh-token rotation:** Cloud Run's filesystem is ephemeral. If Revolut rotates the refresh
  token on refresh, a cold start would fall back to the (now-stale) secret value. Mitigate by
  keeping one warm instance (`--min-instances=1`) or mounting a volume for
  `REVOLUT_TOKEN_STORE_PATH`. Verify the rotation behaviour against the sandbox first.

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
