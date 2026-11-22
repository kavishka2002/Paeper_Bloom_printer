import {execFileSync} from 'node:child_process';
import {createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DAY, PRODUCT, encode} from '../packages/licensing/protocol.mjs';

const local = process.env.LOCALAPPDATA;
const publicFile = new URL('../packages/licensing/public-keys.json', import.meta.url);

function protect(mode, input) {
  const command = [
    'Add-Type -AssemblyName System.Security',
    '$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
    '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::' + mode + '($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))',
  ].join('\n');
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return Buffer.from(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    input: input.toString('base64'), encoding: 'utf8', timeout: 15000, windowsHide: true,
  }).trim(), 'base64');
}

function run([action, deviceId, duration, name, ...extra]) {
  if (process.platform !== 'win32' || !local) throw new Error('Run the issuer from the owner’s Windows account.');
  const directory = join(local, 'BloomConnectIssuer');
  const keyFile = join(directory, 'signing-key.dpapi');
  const pinned = JSON.parse(readFileSync(publicFile, 'utf8'));
  if (action === 'init' && deviceId === undefined && !existsSync(keyFile)) {
    if (Object.keys(pinned).length) throw new Error('A signing key is already pinned. Restore its original private key on the issuer account.');
    mkdirSync(directory, {recursive: true});
    const {privateKey} = generateKeyPairSync('ed25519');
    const der = privateKey.export({type: 'pkcs8', format: 'der'});
    writeFileSync(keyFile, protect('Protect', der), {flag: 'wx'});
  }
  if (action !== 'init' && action !== 'issue') throw new Error('Use init or issue <Device ID> <days> "<customer name>".');
  if (!existsSync(keyFile)) throw new Error('The owner signing key is missing. Run init from the owner’s Windows account.');
  const der = protect('Unprotect', readFileSync(keyFile));
  const key = createPrivateKey({key: der, format: 'der', type: 'pkcs8'});
  der.fill(0);
  const pub = createPublicKey(key).export({format: 'der', type: 'spki'});
  const keyId = createHash('sha256').update(pub).digest('hex');
  if (action === 'init') {
    if (deviceId !== undefined) throw new Error('Use init without arguments.');
    if (Object.keys(pinned).length && pinned[keyId] !== pub.toString('base64url')) throw new Error('The local key does not match the pinned signing key.');
    if (!pinned[keyId]) writeFileSync(publicFile, JSON.stringify({[keyId]: pub.toString('base64url')}, null, 2) + '\n');
    console.log('Owner key is ready. Build BloomConnect with the pinned public key.');
    return;
  }
  if (pinned[keyId] !== pub.toString('base64url')) throw new Error('Run init to pin the issuer’s public key.');
  const days = Number(duration);
  if (!Number.isInteger(days) || days < 1 || days > 365 || !name?.trim() || extra.length) throw new Error('Use issue <Device ID> <days from 1 to 365> "<customer name>".');
  const now = Date.now();
  const signed = encode({licenseId: randomUUID(), productId: PRODUCT, customerName: name.trim(), deviceId: deviceId?.trim(), issuedAt: now,
    validFrom: now, expiresAt: now + days * DAY, version: 1, keyId});
  console.log(signed + '.' + sign(null, Buffer.from(signed, 'ascii'), key).toString('base64url'));
}

try { run(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
