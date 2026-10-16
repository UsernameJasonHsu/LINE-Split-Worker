import { HttpError } from '../errors';
import { http } from '../http';

export interface IdTokenClaims {
  sub: string;
  name?: string;
  picture?: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const MAX_CACHE = 500;
const cache = new Map<string, IdTokenClaims>();

/**
 * Verifies a LIFF ID token with LINE and returns its claims. Verified tokens
 * are cached per isolate until they expire to avoid a round trip per request.
 */
export async function verifyIdToken(idToken: string, loginChannelId: string): Promise<IdTokenClaims> {
  const cached = cache.get(idToken);
  if (cached && cached.exp > Date.now() / 1000) return cached;

  const res = await http.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }),
  });
  if (!res.ok) throw new HttpError(401, 'Invalid or expired ID token');

  const claims = await res.json<IdTokenClaims>();
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(idToken, claims);
  return claims;
}
