import {createHash, createPublicKey, verify, type KeyObject} from 'node:crypto';
import {DAY, DEVICE, PRODUCT, parse} from './protocol.mjs';
import {parseWebsiteLicense, verifyWebsiteSignature} from './website-license';

export type LicenseStatus = {
  allowed: boolean;
  reason: 'trial' | 'licensed' | 'missing' | 'not-started' | 'expired' | 'wrong-device' | 'wrong-product' | 'clock' | 'storage' | 'invalid' | 'invalid-signature' | 'website-key-missing';
  deviceId: string;
  expiresAt?: number;
  activatedAt?: number;
  daysRemaining: number;
  remainingMs?: number;
  customerName?: string;
};
export interface LicenseState {
  version: 1;
  firstLaunch: number;
  latest: number;
  code?: string;
  activatedAt?: number;
}
export const CLOCK_TOLERANCE = 120_000;
export const TRIAL = 48 * 60 * 60 * 1000;

export function makeDeviceId(machineGuid: string) {
  const guid = machineGuid.toLowerCase();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(guid)) throw new Error('Windows device identity is unavailable.');
  return 'BC1-' + createHash('sha256').update('BloomConnect/Windows/MachineGuid/v1\0' + guid).digest('hex').toUpperCase();
}

export function loadKeys(config: Record<string, string>) {
  const keys = new Map<string, KeyObject>();
  for (const [id, value] of Object.entries(config)) {
    const der = Buffer.from(value, 'base64url');
    const key = createPublicKey({key: der, format: 'der', type: 'spki'});
    if (key.asymmetricKeyType !== 'ed25519' || !key.export({format: 'der', type: 'spki'}).equals(der)
      || createHash('sha256').update(der).digest('hex') !== id) throw new Error('Invalid pinned BloomConnect public key.');
    keys.set(id, key);
  }
  return keys;
}

function parseLegacy(code: string) {
  try { return parse(code); } catch { return undefined; }
}

export function checkSigned(code: string, keys: ReadonlyMap<string, KeyObject>, deviceId: string, now: number, websiteKeys: readonly KeyObject[] = []): LicenseStatus {
  const denied = (reason: LicenseStatus['reason']): LicenseStatus => ({allowed: false, reason, deviceId, daysRemaining: 0});
  let entitlement: {deviceId:string; customerName:string; expiresAt:number; startsAt:number};
  const legacy = parseLegacy(code);
  if (legacy) {
    const key = keys.get(legacy.payload.keyId);
    if (!key || !verify(null, Buffer.from(legacy.signed, 'ascii'), key, legacy.signature)) return denied('invalid-signature');
    if (legacy.payload.productId !== PRODUCT) return denied('wrong-product');
    entitlement = {...legacy.payload, startsAt: legacy.payload.validFrom};
  } else {
    let website: ReturnType<typeof parseWebsiteLicense>;
    try { website = parseWebsiteLicense(code); } catch { return denied('invalid'); }
    if (!websiteKeys.length) return denied('website-key-missing');
    if (!verifyWebsiteSignature(website, websiteKeys)) return denied('invalid-signature');
    if (website.product !== 'BloomConnect') return denied('wrong-product');
    entitlement = {...website, startsAt: website.issuedAt};
  }
  if (!DEVICE.test(deviceId) || entitlement.deviceId !== deviceId) return denied('wrong-device');
  const {expiresAt, customerName} = entitlement;
  if (now < entitlement.startsAt) return {...denied('not-started'), expiresAt, customerName};
  if (now >= expiresAt) return {...denied('expired'), expiresAt, customerName};
  return {allowed: true, reason: 'licensed', deviceId, expiresAt, daysRemaining: Math.ceil((expiresAt - now) / DAY), remainingMs: expiresAt - now, customerName};
}

export function checkAccess(state: LicenseState, keys: ReadonlyMap<string, KeyObject>, deviceId: string, wall: number, monotonicFloor = 0, websiteKeys: readonly KeyObject[] = []): LicenseStatus {
  const floor = Math.max(state.latest, monotonicFloor);
  if (wall < floor - CLOCK_TOLERANCE) return {allowed: false, reason: 'clock', deviceId, daysRemaining: 0};
  const now = Math.max(wall, floor);
  if (state.code !== undefined) {
    const result = checkSigned(state.code, keys, deviceId, now, websiteKeys);
    return result.allowed || result.reason === 'expired' ? {...result, activatedAt: state.activatedAt} : result;
  }
  const expiresAt = state.firstLaunch + TRIAL;
  const allowed = now < expiresAt;
  return {allowed, reason: allowed ? 'trial' : 'missing', deviceId, expiresAt, daysRemaining: Math.max(0, Math.ceil((expiresAt - now) / DAY)), remainingMs: Math.max(0, expiresAt - now)};
}
