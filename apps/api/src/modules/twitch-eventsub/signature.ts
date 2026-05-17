import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyEventSubSignature(params: { secret: string; messageId: string; timestamp: string; rawBody: Buffer; signature: string }) {
  const expected = `sha256=${createHmac('sha256', params.secret).update(params.messageId).update(params.timestamp).update(params.rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(params.signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
