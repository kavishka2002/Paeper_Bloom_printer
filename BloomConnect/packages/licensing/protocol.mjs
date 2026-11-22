export const PRODUCT = 'BLOOMCONNECT';
export const DAY = 86_400_000;
export const LIMIT = 4096;
export const DEVICE = /^BC1-[A-F0-9]{64}$/;
const PREFIX = 'BC1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
export const bytes = value => encoder.encode(value);

export function base64(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function unbase64(value) {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) throw new Error('Invalid base64url.');
  const data = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  if (base64(data) !== value) throw new Error('Noncanonical base64url.');
  return data;
}

export function encode(payload) {
  const {licenseId, productId, customerName, deviceId, issuedAt, validFrom, expiresAt, version, keyId} = payload;
  if (version !== 1 || typeof licenseId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(licenseId)
    || typeof productId !== 'string' || !/^[A-Z0-9_-]{1,64}$/.test(productId)
    || typeof customerName !== 'string' || !customerName || customerName !== customerName.trim() || customerName.length > 120 || /[\u0000-\u001f\u007f]/.test(customerName)
    || typeof deviceId !== 'string' || !DEVICE.test(deviceId)
    || typeof keyId !== 'string' || !/^[a-f0-9]{64}$/.test(keyId)
    || ![issuedAt, validFrom, expiresAt].every(time => Number.isSafeInteger(time) && time >= 0 && time <= 8.64e15)
    || expiresAt <= validFrom || expiresAt - validFrom > 365 * DAY) throw new Error('Invalid license payload.');
  return PREFIX + '.' + base64(bytes(JSON.stringify({licenseId, productId, customerName, deviceId, issuedAt, validFrom, expiresAt, version, keyId})));
}

export function parse(code) {
  if (typeof code !== 'string' || code.length > LIMIT) throw new Error('Invalid license code size.');
  const token = code.trim();
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('Invalid license format.');
  const payload = JSON.parse(decoder.decode(unbase64(parts[1])));
  const signature = unbase64(parts[2]);
  const signed = parts.slice(0, 2).join('.');
  if (signature.length !== 64 || encode(payload) !== signed) throw new Error('Invalid canonical license.');
  return {payload, signature, signed, token};
}
