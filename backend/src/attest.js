/* Proving the caller is the real app.
 *
 * The service is public, and a public service that hands out Google calls will
 * hand them to whoever asks — including a clone of this app with someone else's
 * name on it, spending our quota until the day is used up and the real app
 * stops working. Shutting the Worker down stops the clone and every real driver
 * with it; there is one door and both come through it. So the answer cannot be
 * to close it, it has to be to tell them apart at it.
 *
 * A secret baked into the APK cannot do that. It would be extracted exactly the
 * way the API key was extracted, and the clone would send the same secret. Any
 * scheme where the proof lives inside the thing being copied is a scheme that
 * copies with it.
 *
 * What a clone cannot obtain is a statement from Google about *which* app is
 * running. Play Integrity signs one: this package name, this signing
 * certificate, installed by Play, unmodified. The clone is signed with its own
 * key — that is what makes it a different app — so Google will not say this
 * about it, and the statement cannot be forged because we check it with Google
 * rather than trusting what arrived.
 *
 *   GET  /auth/nonce      a one-shot number, valid for two minutes
 *   POST /auth/verify     the Google-signed token for that nonce, in exchange
 *                         for a session token good for a day
 *
 * The nonce is what stops replay. Without it a token captured once could be
 * resent forever; with it, a token is an answer to a question this service
 * asked, and it asks a different one every time.
 *
 * The session token exists so this is not on the path of every request. Play
 * Integrity is rate-limited and slow — a second or more — and a plan makes a
 * dozen calls. Attest once at start-up, carry the result.
 */

const NONCE_TTL = 120;              // seconds — long enough for a slow handset
const SESSION_TTL = 24 * 3600;

/* The app this service exists for. A token that verifies perfectly but names a
 * different package is exactly the thing being kept out. */
const PACKAGE = 'com.evroute.app';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const rand = n => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b.buffer);
};

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** A nonce, remembered so it can be spent exactly once. */
export async function newNonce(kv) {
  const nonce = rand(24);
  await kv.put(`nc:${nonce}`, '1', { expirationTtl: NONCE_TTL });
  return { nonce, expiresIn: NONCE_TTL };
}

/* Session tokens are signed, not stored.
 *
 * Storing them would mean a KV write per app start and a read per request,
 * which is the busiest thing this service does and the one with a hard free
 * limit. A token that carries its own expiry and a signature over it needs
 * neither: it cannot be edited without the secret, and it cannot outlive its
 * own timestamp. The cost is that it cannot be revoked early — acceptable for
 * something that expires in a day on its own. */
async function mint(secret) {
  const body = `${Date.now() + SESSION_TTL * 1000}.${rand(9)}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function validSession(secret, token) {
  if (!token) return false;
  const cut = token.lastIndexOf('.');
  if (cut < 0) return false;
  const body = token.slice(0, cut);
  const sig = token.slice(cut + 1);
  if (await hmac(secret, body) !== sig) return false;
  const expiry = parseInt(body.split('.')[0], 10);
  return isFinite(expiry) && Date.now() < expiry;
}

/* Google's own verdict on the token, asked of Google.
 *
 * Play Integrity tokens can be decoded locally with keys managed in the Play
 * Console, which is faster and one more thing to get wrong. This asks the
 * server instead: one call per app start, not per request, and the answer is
 * whatever Google says today rather than whatever we understood in August. */
async function decode(env, token) {
  const url = `https://playintegrity.googleapis.com/v1/${PACKAGE}:decodeIntegrityToken`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await googleToken(env)}`,
    },
    body: JSON.stringify({ integrityToken: token }),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = JSON.stringify(await r.json()).slice(0, 300); } catch { /* not json */ }
    console.warn(`integrity decode ${r.status} ${detail}`);
    const e = new Error('could not check that token');
    e.status = 502;
    throw e;
  }
  return (await r.json()).tokenPayloadExternal || {};
}

/* A Google access token from the service account, cached until it nearly
 * expires. Signing a JWT here rather than pulling in a library: it is two
 * base64 segments and one RS256 signature, and a dependency that runs on every
 * cold start is worse than twenty lines. */
async function googleToken(env) {
  const hit = await env.CACHE.get('gtok');
  if (hit) return hit;

  const sa = JSON.parse(env.SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/playintegrity',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claim)}`;

  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(unsigned)));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!r.ok) {
    console.warn(`service account auth ${r.status}`);
    const e = new Error('this service is misconfigured');
    e.status = 500;
    throw e;
  }
  const j = await r.json();
  /* A minute short of the real expiry, so a request in flight when it lapses
   * does not fail on a token that was valid when it started. */
  await env.CACHE.put('gtok', j.access_token, { expirationTtl: j.expires_in - 60 });
  return j.access_token;
}

const fail = (msg, status = 403) => { const e = new Error(msg); e.status = status; throw e; };

/** The Google-signed token, checked, in exchange for a session. */
export async function verify(env, token, nonce) {
  if (!token || !nonce) fail('nothing to check', 400);

  /* Spent first, and unconditionally. A nonce that is only consumed on success
   * lets the same one be tried until something gets through. */
  const held = await env.CACHE.get(`nc:${nonce}`);
  await env.CACHE.delete(`nc:${nonce}`);
  if (!held) fail('that nonce is used or expired');

  const p = await decode(env, token);

  const req = p.requestDetails || {};
  if (req.requestPackageName !== PACKAGE) fail('that token is for another app');
  /* Google echoes the nonce back as requestHash for the standard API. If it
   * does not match, the token answers a question somebody else asked. */
  if (req.requestHash !== nonce) fail('that token answers a different question');

  const app = p.appIntegrity || {};
  if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    /* UNRECOGNIZED_VERSION is the honest name for a clone: it is this package,
     * but not this signing certificate and not from Play. */
    fail(`this build is not recognised by Play (${app.appRecognitionVerdict || 'no verdict'})`);
  }
  if (app.packageName && app.packageName !== PACKAGE) fail('that token is for another app');

  /* Device integrity is checked but not required to be perfect. A rooted phone
   * is not a clone, and refusing it would lock out a slice of real users to
   * stop nothing — the app recognition above is what identifies the caller.
   * What is refused is a device Google cannot say anything about at all. */
  const device = (p.deviceIntegrity || {}).deviceRecognitionVerdict || [];
  if (!device.length) fail('that device cannot be checked');

  return { session: await mint(env.SESSION_SECRET), expiresIn: SESSION_TTL };
}
