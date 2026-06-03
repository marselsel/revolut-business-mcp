/**
 * One-time bootstrap: obtain a Revolut Business refresh token.
 *
 * Prereqs (Revolut Business → APIs → API certificates):
 *   openssl genpkey -algorithm RSA -out privatecert.pem -pkeyopt rsa_keygen_bits:2048
 *   openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825
 *   → upload publiccert.cer, copy the Client ID, set the OAuth redirect URI.
 *     The redirect URI's DOMAIN must equal REVOLUT_JWT_ISSUER.
 *
 * Run:
 *   REVOLUT_CLIENT_ID=... REVOLUT_JWT_ISSUER=example.com \
 *   REVOLUT_PRIVATE_KEY_PATH=./privatecert.pem REVOLUT_ENVIRONMENT=sandbox \
 *   npm run authorize
 *
 * Add scopes for the payments tier with REVOLUT_SCOPE="READ,WRITE,PAY".
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { SignJWT } from "jose";

const env = process.env;

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const clientId = env.REVOLUT_CLIENT_ID?.trim();
if (!clientId) fail("REVOLUT_CLIENT_ID is required.");

const jwtIssuer = env.REVOLUT_JWT_ISSUER?.trim();
if (!jwtIssuer) fail("REVOLUT_JWT_ISSUER is required (your redirect URI's domain, e.g. example.com).");

const environment = env.REVOLUT_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
if (environment !== "production" && environment !== "sandbox") {
  fail('REVOLUT_ENVIRONMENT must be "production" or "sandbox".');
}

const base =
  environment === "sandbox"
    ? "https://sandbox-b2b.revolut.com/api/1.0"
    : "https://b2b.revolut.com/api/1.0";
const tokenUrl = env.REVOLUT_TOKEN_URL?.trim() || `${base}/auth/token`;

let privateKeyPem = env.REVOLUT_PRIVATE_KEY?.trim();
if (privateKeyPem?.includes("\\n")) privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
if (!privateKeyPem && env.REVOLUT_PRIVATE_KEY_PATH) {
  try {
    privateKeyPem = readFileSync(env.REVOLUT_PRIVATE_KEY_PATH.trim(), "utf8");
  } catch (e) {
    fail(`Could not read REVOLUT_PRIVATE_KEY_PATH: ${e instanceof Error ? e.message : "unknown"}`);
  }
}
if (!privateKeyPem) fail("Set REVOLUT_PRIVATE_KEY (PEM contents) or REVOLUT_PRIVATE_KEY_PATH (file).");

let privateKey: KeyObject;
try {
  privateKey = createPrivateKey(privateKeyPem);
} catch (e) {
  fail(`Invalid private key: ${e instanceof Error ? e.message : "unknown"}`);
}

const redirectUri = env.REVOLUT_REDIRECT_URI?.trim() || `https://${jwtIssuer}`;
const scope = env.REVOLUT_SCOPE?.trim() || "READ,WRITE";

// Consent host. Overridable via REVOLUT_CONSENT_HOST — the sandbox host can vary, so
// use whatever domain you're logged into the sandbox Business app on if the default 404s.
const consentHost =
  env.REVOLUT_CONSENT_HOST?.trim() ||
  (environment === "sandbox" ? "https://sandbox-business.revolut.com" : "https://business.revolut.com");
const consentUrl =
  `${consentHost}/app-confirm?client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;

console.log(`\nRevolut Business — one-time authorization (${environment})\n`);
console.log("1) Open this URL in your browser and approve access:\n");
console.log(`   ${consentUrl}\n`);
console.log(`2) You'll be redirected to ${redirectUri}?code=...  (the code is valid ~2 minutes)\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question("3) Paste the `code` value from the redirect URL here: ")).trim();
rl.close();
if (!code) fail("No code provided.");

const nowSec = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({})
  .setProtectedHeader({ alg: "RS256", typ: "JWT" })
  .setIssuer(jwtIssuer)
  .setSubject(clientId)
  .setAudience("https://revolut.com")
  .setIssuedAt(nowSec)
  .setExpirationTime(nowSec + 600)
  .sign(privateKey);

const form = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
  client_assertion: assertion,
});

const res = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: form.toString(),
});
const text = await res.text();
if (!res.ok) fail(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);

let data: { access_token?: string; refresh_token?: string; expires_in?: number };
try {
  data = JSON.parse(text);
} catch {
  fail(`Token endpoint returned a non-JSON response: ${text.slice(0, 200)}`);
}
if (!data.refresh_token) fail(`No refresh_token in the response: ${text.slice(0, 200)}`);

console.log("\n✓ Success! Set this as a secret (never commit it):\n");
console.log(`   REVOLUT_REFRESH_TOKEN=${data.refresh_token}\n`);
console.log(`(access token ttl ~${data.expires_in ?? "?"}s — the server refreshes automatically)\n`);
