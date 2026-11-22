const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash, generateKeyPairSync, randomUUID, sign} = require('node:crypto');
const {buildSync} = require('esbuild');
const {join} = require('node:path');
const {outputFiles} = buildSync({absWorkingDir: join(__dirname, '..'), stdin: {
  contents: "export * from './packages/licensing/license'; export * from './packages/licensing/website-license'; export * from './packages/licensing/protocol.mjs'; export * from './packages/shared/support';",
  resolveDir: join(__dirname, '..'),
}, bundle: true, platform: 'node', write: false});
const fixture = {exports: {}};
new Function('require', 'module', 'exports', outputFiles[0].text)(require, fixture, fixture.exports);

const {checkAccess, checkSigned, loadKeys, makeDeviceId, encode, parse, DAY, PRODUCT, TRIAL, openLicensePurchase, loadWebsiteKeys} = fixture.exports;
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const der = publicKey.export({type: 'spki', format: 'der'});
const keyId = createHash('sha256').update(der).digest('hex');
const keys = loadKeys({[keyId]: der.toString('base64url')});
const deviceId = makeDeviceId('06db1ab5-3b08-4f2b-89b9-82ab9c3d6088');
const start = Date.UTC(2026, 10, 21);
const state = {version: 1, firstLaunch: start, latest: start};

function generate(overrides = {}) {
  const signed = encode({licenseId: randomUUID(), productId: PRODUCT, customerName: 'Test customer', deviceId,
    issuedAt: start, validFrom: start, expiresAt: start + 365 * DAY, version: 1, keyId, ...overrides});
  return signed + '.' + sign(null, Buffer.from(signed), privateKey).toString('base64url');
}

test('valid annual license and file round trip', () => {
  const result = checkSigned(generate() + '\r\n', keys, deviceId, start);
  assert.equal(result.reason, 'licensed');
  assert.equal(result.daysRemaining, 365);
  assert.equal(result.remainingMs, 365 * DAY);
  assert.equal(checkSigned(generate(), keys, deviceId, start + 60_000).remainingMs, 365 * DAY - 60_000);
  assert.equal(result.expiresAt, start + 365 * DAY);
});

test('modified payload, forged signatures and unknown keys fail', () => {
  const code = generate();
  const {payload, signature} = parse(code);
  const edited = encode({...payload, customerName: 'Modified'}) + '.' + Buffer.from(signature).toString('base64url');
  signature[0] ^= 1;
  const forged = code.split('.').slice(0, 2).join('.') + '.' + Buffer.from(signature).toString('base64url');
  for (const invalid of ['', edited, forged, generate({keyId: '0'.repeat(64)})]) {
    assert.ok(['invalid', 'invalid-signature'].includes(checkSigned(invalid, keys, deviceId, start).reason));
  }
});

test('wrong device, wrong product, start and exclusive expiry', () => {
  assert.equal(checkSigned(generate(), keys, 'BC1-' + 'A'.repeat(64), start).reason, 'wrong-device');
  assert.equal(checkSigned(generate({productId: 'OTHER'}), keys, deviceId, start).reason, 'wrong-product');
  assert.equal(checkSigned(generate(), keys, deviceId, start - 1).reason, 'not-started');
  assert.equal(checkSigned(generate(), keys, deviceId, start + 365 * DAY).reason, 'expired');
});

test('missing license, 48-hour cutoff and rollback after restart or within a session', () => {
  assert.equal(checkAccess(state, keys, deviceId, start).remainingMs, TRIAL);
  const finalMoment = checkAccess(state, keys, deviceId, start + TRIAL - 1);
  assert.equal(finalMoment.allowed, true);
  assert.equal(finalMoment.remainingMs, 1);
  const ended = checkAccess(state, keys, deviceId, start + TRIAL);
  assert.equal(ended.allowed, false);
  assert.equal(ended.reason, 'missing');
  assert.equal(ended.remainingMs, 0);
  assert.equal(ended.deviceId, deviceId);
  assert.equal(checkAccess({...state, latest: start + DAY}, keys, deviceId, start).reason, 'clock');
  assert.equal(checkAccess(state, keys, deviceId, start, start + DAY).reason, 'clock');
  assert.equal(checkAccess({...state, latest: start + TRIAL}, keys, deviceId, start + TRIAL - 1).reason, 'missing');
});

test('renewal authorizes the same device from the signed renewal start', () => {
  const validFrom = start + 365 * DAY;
  const renewal = generate({validFrom, expiresAt: validFrom + 365 * DAY});
  assert.equal(checkSigned(renewal, keys, deviceId, validFrom - 1).reason, 'not-started');
  assert.equal(checkSigned(renewal, keys, deviceId, validFrom).reason, 'licensed');
});

test('purchase opens the support WhatsApp chat with the Device ID prefilled', async () => {
  let opened;
  await openLicensePurchase(deviceId, '  PaperBloom   Print Shop  ', async url => { opened = new URL(url); });
  assert.equal(opened.origin, 'https://wa.me');
  assert.equal(opened.pathname, '/94767660922');
  const message = opened.searchParams.get('text');
  assert.match(message, /365-day BloomConnect license/);
  assert.match(message, /දින 365 බලපත්‍රයක්/);
  assert.ok(message.includes('Shop name / වෙළඳසැලේ නම: PaperBloom Print Shop'));
  assert.ok(message.includes('Device ID: ' + deviceId));
  await assert.rejects(openLicensePurchase(deviceId, '  ', async () => assert.fail('Unexpected WhatsApp launch')), /shop name/);
});

const mobile = require('./fixtures/mobile-license.json');
const websiteKeys = loadWebsiteKeys([mobile.publicKey]);
const verifyMobile = (code, device = mobile.payload.device, now = mobile.payload.issued) =>
  checkSigned(code, keys, device, now, websiteKeys);

test('actual generator Web Crypto vector verifies offline alongside the existing Ed25519 format', () => {
  const result = verifyMobile(mobile.license);
  assert.equal(result.reason, 'licensed');
  assert.equal(result.customerName, mobile.payload.customer);
  assert.equal(result.expiresAt, mobile.payload.expires);
  assert.equal(result.daysRemaining, 30);
  assert.equal(checkSigned(generate(), keys, deviceId, start, websiteKeys).reason, 'licensed');
  assert.equal(checkSigned(mobile.license, keys, mobile.payload.device, start).reason, 'website-key-missing');
  assert.throws(() => loadWebsiteKeys([{...mobile.publicKey, d: 'private-material'}]), /public ECDSA/);
});

test('website licenses reject malformed, tampered, wrong-device and inactive tokens', () => {
  const [prefix, body, signature] = mobile.license.split('.');
  const badSig = Buffer.from(signature, 'base64url'); badSig[0] ^= 1;
  assert.equal(verifyMobile([prefix, body, badSig.toString('base64url')].join('.')).reason, 'invalid-signature');
  for (const payload of [{...mobile.payload, expires: mobile.payload.expires + DAY}, {...mobile.payload, customer:'Modified'}]) {
    const edited = [prefix, Buffer.from(JSON.stringify(payload)).toString('base64url'), signature].join('.');
    assert.equal(verifyMobile(edited).reason, 'invalid-signature');
  }
  assert.equal(verifyMobile([prefix, body].join('.')).reason, 'invalid');
  assert.equal(verifyMobile(mobile.license, deviceId).reason, 'wrong-device');
  assert.equal(verifyMobile(mobile.license, mobile.payload.device, mobile.payload.issued - 1).reason, 'not-started');
  assert.equal(verifyMobile(mobile.license, mobile.payload.device, mobile.payload.expires).reason, 'expired');
});

test('website renewal extends the expiry for the same device', () => {
  const now = mobile.payload.issued + DAY;
  assert.equal(verifyMobile(mobile.renewal, mobile.payload.device, now).daysRemaining, 60);
  assert.equal(verifyMobile(mobile.renewal, mobile.payload.device, now).expiresAt, now + 60 * DAY);
});

test('website signatures from an untrusted key and legacy licenses with an unknown key ID are rejected', () => {
  const other = generateKeyPairSync('ec', {namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  assert.equal(checkSigned(mobile.license, keys, mobile.payload.device, mobile.payload.issued, loadWebsiteKeys([other])).reason, 'invalid-signature');
  const unknown = generate({keyId:'f'.repeat(64)});
  assert.equal(checkSigned(unknown, keys, deviceId, start, websiteKeys).reason, 'invalid-signature');
});
