import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/line/signature';

const secret = 'channel-secret';
const body = '{"events":[]}';
const sign = (b: string, s = secret) => createHmac('sha256', s).update(b).digest('base64');

describe('verifySignature', () => {
  it('accepts a correct signature', async () => {
    expect(await verifySignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects tampered bodies and wrong secrets', async () => {
    expect(await verifySignature(`${body} `, sign(body), secret)).toBe(false);
    expect(await verifySignature(body, sign(body, 'other'), secret)).toBe(false);
  });

  it('rejects missing or malformed signatures and an unset secret', async () => {
    expect(await verifySignature(body, undefined, secret)).toBe(false);
    expect(await verifySignature(body, '***not base64***', secret)).toBe(false);
    expect(await verifySignature(body, sign(body, ''), '')).toBe(false);
  });
});
