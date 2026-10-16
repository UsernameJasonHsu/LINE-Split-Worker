const encoder = new TextEncoder();

/** Verifies the X-Line-Signature header (base64 HMAC-SHA256 of the raw body). */
export async function verifySignature(
  body: string,
  signature: string | undefined,
  channelSecret: string,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;

  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(signature), (ch) => ch.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, sig, encoder.encode(body));
}
