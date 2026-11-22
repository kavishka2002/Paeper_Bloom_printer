import {createHash, createPublicKey, verify, type KeyObject} from 'node:crypto';
import {unbase64} from './protocol.mjs';

export const WEBSITE_LICENSE_LIMIT = 8192;

export function loadWebsiteKeys(config: unknown): KeyObject[] {
  if (!Array.isArray(config)) throw new Error('Expected a list of website public keys.');
  return config.map(jwk => {
    if (!jwk || typeof jwk !== 'object' || Object.keys(jwk).some(field => !['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(field))
      || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || unbase64(jwk.x).length !== 32 || unbase64(jwk.y).length !== 32
      || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'verify'))) {
      throw new Error('Expected a public ECDSA P-256 website key.');
    }
    return createPublicKey({key: jwk, format: 'jwk'});
  });
}

// Matches shared/license.ts and desktop/verify-license.mjs in the mobile generator.
export function parseWebsiteLicense(code: string) {
  const token = code.trim();
  if (code.length > WEBSITE_LICENSE_LIMIT) throw new Error('License is too large.');
  const [prefix, body, encodedSignature, ...extra] = token.split('.');
  if (prefix !== 'BC1' || !body || !encodedSignature || extra.length) throw new Error('Unsupported license format.');
  const signature = unbase64(encodedSignature);
  if (signature.length !== 64) throw new Error('Invalid signature length.');
  const p = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(unbase64(body)));
  if (!p || typeof p !== 'object' || Object.hasOwn(p, 'version') || Object.hasOwn(p, 'keyId') || p.v !== 1
    || (p.kid !== undefined && (typeof p.kid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(p.kid)))
    || typeof p.product !== 'string' || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(p.id)
    || typeof p.customer !== 'string' || !p.customer.trim() || p.customer.length > 160
    || typeof p.phone !== 'string' || p.phone.length > 50
    || typeof p.device !== 'string' || !p.device || p.device.length > 256 || p.device !== p.device.trim()
    || !Number.isSafeInteger(p.issued) || !Number.isSafeInteger(p.expires)
    || p.issued < 0 || p.expires <= p.issued || p.expires > 8_640_000_000_000_000) throw new Error('Invalid license payload.');
  return {
    product: p.product as string, deviceId: p.device as string, customerName: p.customer as string,
    issuedAt: p.issued as number, expiresAt: p.expires as number,
    kid: p.kid as string | undefined,
    signed: Buffer.from(prefix + '.' + body, 'ascii'), signature,
  };
}

export function verifyWebsiteSignature(parsed: ReturnType<typeof parseWebsiteLicense>, keys: readonly KeyObject[]) {
  return keys.some(key => {
    if (parsed.kid !== undefined) {
      const {crv, kty, x, y} = key.export({format: 'jwk'});
      if (parsed.kid !== createHash('sha256').update(JSON.stringify({crv, kty, x, y})).digest('base64url')) return false;
    }
    return verify('sha256', parsed.signed, {key, dsaEncoding: 'ieee-p1363'}, parsed.signature);
  });
}
