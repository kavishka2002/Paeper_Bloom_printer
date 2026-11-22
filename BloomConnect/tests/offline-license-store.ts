import assert from 'node:assert/strict';
import {app, safeStorage} from 'electron';
import {createHash, generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfflineLicense} from '../apps/desktop/offline-license';
import {PRODUCT, DAY, encode} from '../packages/licensing/protocol.mjs';

void app.whenReady().then(async () => {
  const root = mkdtempSync(join(tmpdir(), 'bloomconnect-license-test-'));
  const realNow = Date.now;
  try {
    assert.equal(process.platform, 'win32');
    assert.ok(safeStorage.isEncryptionAvailable());
    const customerData = Buffer.from('existing customer database fixture');
    const document = Buffer.from('existing customer document fixture');
    writeFileSync(join(root, 'bloomconnect.sqlite'), customerData);
    mkdirSync(join(root, 'documents'));
    writeFileSync(join(root, 'documents', 'order.pdf'), document);
    const {privateKey, publicKey} = generateKeyPairSync('ed25519');
    const der = publicKey.export({format: 'der', type: 'spki'});
    const keyId = createHash('sha256').update(der).digest('hex');
    const keys = {[keyId]: der.toString('base64url')};
    const start = Date.UTC(2026, 10, 21);
    let now = start;
    Date.now = () => now;
    let license = openOfflineLicense(root, keys);
    const trial = license.status();
    const deviceId = trial.deviceId;
    assert.equal(trial.reason, 'trial');
    assert.equal(trial.expiresAt, start + 2 * DAY);
    now = start + 2 * DAY;
    assert.equal(license.status().reason, 'missing');
    license.flush();
    license = openOfflineLicense(root, keys);
    assert.equal(license.status().deviceId, deviceId);
    assert.equal(license.status().reason, 'missing');
    now -= DAY;
    assert.equal(license.status().reason, 'clock');
    now += DAY;

    function issue(validFrom: number) {
      const signed = encode({licenseId: randomUUID(), deviceId, productId: PRODUCT, customerName: 'Existing customer',
        issuedAt: now, validFrom, expiresAt: validFrom + 365 * DAY, version: 1, keyId});
      return signed + '.' + sign(null, Buffer.from(signed), privateKey).toString('base64url');
    }

    const code = issue(now);
    const path = join(root, 'test.bclicense');
    writeFileSync(path, code + '\n');
    assert.equal(license.activate(readFileSync(path, 'utf8')).reason, 'licensed');
    assert.equal(license.activate('corrupted code').reason, 'invalid');
    const renewal = issue(now + 365 * DAY);
    assert.equal(license.activate(renewal).reason, 'not-started');
    license = openOfflineLicense(root, keys);
    assert.equal(license.status().reason, 'licensed');
    now += 365 * DAY;
    assert.equal(license.status().reason, 'expired');
    assert.equal(license.activate(renewal).reason, 'licensed');
    const generatorPath = process.env.BLOOMCONNECT_TEST_SIGNER;
    if (generatorPath) {
      const generator = require(generatorPath);
      const webKey = await generator.createSigningKey();
      const webPublic = await generator.publicKeyJson(webKey.publicKey);
      const kid = await generator.keyId(webPublic);
      const issueDate = new Date(now).toISOString().slice(0, 10);
      const webCode = await generator.signLicense(generator.createPayload({
        customer:'Mobile generator customer', device:deviceId, issueDate, days:365, kid,
      }), webKey.privateKey);
      const renewalDate = new Date(now + DAY).toISOString().slice(0, 10);
      const webRenewal = await generator.signLicense(generator.createPayload({
        customer:'Mobile generator customer', device:deviceId, issueDate:renewalDate, days:365, kid,
      }), webKey.privateKey);
      license = openOfflineLicense(root, keys, [webPublic]);
      assert.equal(license.status().reason, 'licensed');
      const wrongKid = await generator.signLicense(generator.createPayload({
        customer:'Mobile generator customer', device:deviceId, issueDate, days:365, kid: 'A'.repeat(43),
      }), webKey.privateKey);
      assert.equal(license.activate(wrongKid).reason, 'invalid-signature');
      const activated = license.activate(webCode);
      assert.equal(activated.reason, 'licensed');
      assert.equal(activated.customerName, 'Mobile generator customer');
      assert.ok(activated.activatedAt);
      assert.equal(activated.expiresAt, Date.parse(issueDate) + 365 * DAY);
      license = openOfflineLicense(root, keys, [webPublic]);
      assert.equal(license.status().activatedAt, activated.activatedAt);
      assert.equal(license.status().expiresAt, activated.expiresAt);
      now += DAY;
      const renewed = license.activate(webRenewal);
      assert.equal(renewed.reason, 'licensed');
      assert.ok(renewed.expiresAt! > activated.expiresAt!);
      assert.ok(renewed.activatedAt! > activated.activatedAt!);
      assert.equal(openOfflineLicense(root, keys, [webPublic]).status().expiresAt, renewed.expiresAt);
      console.log('Mobile generator to Windows Electron/DPAPI activation, reopened storage and renewal passed with an ephemeral website key.');
    }
    const corruptRoot = join(root, 'corrupt-store');
    mkdirSync(corruptRoot);
    assert.equal(openOfflineLicense(corruptRoot, keys).status().reason, 'trial');
    const corrupt = Buffer.from('corrupt license storage');
    writeFileSync(join(corruptRoot, 'offline-license.dpapi'), corrupt);
    assert.equal(openOfflineLicense(corruptRoot, keys).status().reason, 'storage');
    assert.deepEqual(readFileSync(join(corruptRoot, 'offline-license.dpapi')), corrupt);
    assert.deepEqual(readFileSync(join(root, 'bloomconnect.sqlite')), customerData);
    assert.deepEqual(readFileSync(join(root, 'documents', 'order.pdf')), document);
    console.log('Windows DPAPI trial, rollback, activation, expiry, renewal and data preservation passed.');
  } finally {
    Date.now = realNow;
    rmSync(root, {recursive: true, force: true});
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
