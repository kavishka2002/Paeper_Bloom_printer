import {safeStorage} from 'electron';
import {execFileSync} from 'node:child_process';
import {readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkAccess, loadKeys, makeDeviceId, type LicenseState, type LicenseStatus} from '../../packages/licensing/license';
import {WEBSITE_LICENSE_LIMIT, loadWebsiteKeys} from '../../packages/licensing/website-license';
import websitePublicKeys from '../../packages/licensing/website-public-keys.json';
import publicKeys from '../../packages/licensing/public-keys.json';

export function openOfflineLicense(root: string, verificationKeys: Record<string, string> = publicKeys, websiteVerificationKeys: unknown = websitePublicKeys) {
  const registry = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const deviceId = makeDeviceId(execFileSync(registry,
    ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
    {encoding: 'utf8', windowsHide: true, timeout: 5000}).match(/REG_SZ\s+([\da-f-]+)/i)?.[1] ?? '');
  const keys = loadKeys(verificationKeys);
  const websiteKeys = loadWebsiteKeys(websiteVerificationKeys);
  const path = join(root, 'offline-license.dpapi');
  const began = Date.now();
  const counter = performance.now();
  let state: LicenseState | undefined;
  let persisted = 0;
  let storageReady = false;

  function save(next: LicenseState) {
    const temp = path + '.' + randomUUID();
    try {
      writeFileSync(temp, safeStorage.encryptString(JSON.stringify(next)), {flag: 'wx', flush: true});
      renameSync(temp, path);
      persisted = next.latest;
    } finally {
      try { unlinkSync(temp); } catch { /* Renamed or never created. */ }
    }
  }

  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.');
    let encrypted: Buffer | undefined;
    try { encrypted = readFileSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (encrypted) {
      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as LicenseState;
      if (parsed?.version !== 1 || !Number.isSafeInteger(parsed.firstLaunch) || !Number.isSafeInteger(parsed.latest)
        || parsed.firstLaunch < 0 || parsed.latest < parsed.firstLaunch || parsed.latest > 8.64e15 - 172_800_000
        || (parsed.code !== undefined && (typeof parsed.code !== 'string' || parsed.code.length > WEBSITE_LICENSE_LIMIT))
        || (parsed.activatedAt !== undefined && (!Number.isSafeInteger(parsed.activatedAt) || parsed.activatedAt < parsed.firstLaunch || parsed.activatedAt > parsed.latest))) throw new Error('Invalid local license state.');
      state = parsed;
      persisted = parsed.latest;
    } else {
      state = {version: 1, firstLaunch: began, latest: began};
      save(state);
    }
    storageReady = true;
  } catch { /* Missing protection or damaged state must not start a fresh trial. */ }

  function status(code?: string): LicenseStatus {
    if (!state || !storageReady) return {allowed: false, reason: 'storage', deviceId, daysRemaining: 0};
    const wall = Date.now();
    const floor = Math.floor(began + performance.now() - counter);
    const latest = Math.max(state.latest, wall, floor);
    const candidate = code === undefined || code === state.code ? state : {...state, code, activatedAt: latest};
    const result = checkAccess(candidate, keys, deviceId, wall, floor, websiteKeys);
    if (result.reason !== 'clock') {
      const next = {...candidate, latest};
      if (code === undefined || result.allowed) {
        try {
          if (code !== undefined || latest - persisted >= 15_000 || (result.expiresAt !== undefined && persisted < result.expiresAt && latest >= result.expiresAt)) save(next);
          state = next;
        } catch {
          storageReady = false;
          return {allowed: false, reason: 'storage', deviceId, daysRemaining: 0};
        }
      }
    }
    return result;
  }

  return {
    status: () => status(),
    activate: (code: string) => status(code.trim()),
    flush() {
      if (state && storageReady && state.latest > persisted) {
        try { save(state); } catch { /* Keep the last successful checkpoint. */ }
      }
    },
  };
}
