import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Issue #8 (PRD area E): the signed webhook is the source of truth for
 * payment, not any client callback. Computed over the raw request bytes —
 * never over a re-serialized `JSON.stringify(req.body)`, which can differ
 * from the bytes Razorpay actually signed (key order, whitespace) and would
 * make a genuine signature fail to verify.
 */
export function verifyRazorpaySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, signatureBuf);
}
