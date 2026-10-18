// Cloudflare Access test identity shared by the Worker tests: a throwaway RSA
// key signs Access JWTs, and ACCESS_TEST_ENV points the Worker at it.
const TEAM = "secopsai-test.cloudflareaccess.com";
const AUD = "secopsai-test-audience";
const KID = "secopsai-test-key";

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: KID, alg: "RS256" };

export async function accessJwt(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    aud: [AUD], iss: `https://${TEAM}`, email: "operator@example.com", sub: "operator-1", iat: now, nbf: now - 5, exp: now + 3600, ...claims,
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

export const ACCESS_TEST_ENV = {
  CF_ACCESS_TEAM_DOMAIN: TEAM,
  CF_ACCESS_AUD: AUD,
  DASHBOARD_OPERATOR_EMAILS: "operator@example.com",
  ACCESS_CERTS_FETCHER: { fetch: async () => Response.json({ keys: [publicJwk] }) },
};
