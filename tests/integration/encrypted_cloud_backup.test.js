const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cloudService = require('../../server/services/cloudBackupCryptoService');

describe('Encrypted Cloud Backup & System Vault Suite', () => {
  const testPassphrase = 'RawasiSuperSecurePass2026!';

  it('1. should encrypt and decrypt data with AES-256-GCM and verify integrity', () => {
    const rawData = Buffer.from('عقود ومستخلصات وبيانات مالية سرية لشركة رواسي عدن');
    const encrypted = cloudService.encryptBuffer(rawData, testPassphrase);

    assert.ok(Buffer.isBuffer(encrypted), 'Result must be a buffer');
    assert.ok(encrypted.length > rawData.length + 50, 'Encrypted buffer must include magic, salt, IV, tag');
    assert.equal(cloudService.isEncrypted(encrypted), true, 'Must be identified as encrypted by magic header');

    // Decrypt with correct passphrase
    const decrypted = cloudService.decryptBuffer(encrypted, testPassphrase);
    assert.equal(decrypted.toString('utf8'), rawData.toString('utf8'), 'Decrypted text must match original');

    // Decrypt with wrong passphrase must fail
    assert.throws(() => {
      cloudService.decryptBuffer(encrypted, 'WrongPassword999!');
    }, /فشل فك التشفير/, 'Wrong passphrase must throw authentication error');

    // Tampered data must fail authentication tag
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xFF; // flip bit
    assert.throws(() => {
      cloudService.decryptBuffer(tampered, testPassphrase);
    }, /فشل فك التشفير/, 'Tampered ciphertext must fail GCM auth tag');
  });

  it('2. should generate strong random security keys', () => {
    const key1 = cloudService.generateSecureKey(24);
    const key2 = cloudService.generateSecureKey(24);
    assert.equal(key1.length, 24);
    assert.equal(key2.length, 24);
    assert.notEqual(key1, key2, 'Generated keys must be unique random');
  });

  it('3. should create a full encrypted system archive bundle', async () => {
    const archive = await cloudService.createFullSystemArchive({
      encrypt: true,
      passphrase: testPassphrase,
      includeProjectsFiles: true,
      user: 'test_auditor'
    });

    assert.equal(archive.success, true);
    assert.equal(archive.encrypted, true);
    assert.ok(archive.fileName.endsWith('.rawasi.enc'));
    assert.ok(fs.existsSync(archive.filePath), 'Archive file must exist in cloud vault');
    assert.ok(archive.fileSize > 0);
    assert.ok(archive.sha256 && archive.sha256.length === 64);
    assert.equal(cloudService.isEncrypted(archive.filePath), true);

    // Inspect archive
    const inspection = cloudService.inspectArchive(archive.filePath, testPassphrase);
    assert.equal(inspection.encrypted, true);
    assert.equal(inspection.hasDatabase, true);
    assert.ok(inspection.manifest, 'Manifest must be present');
    assert.equal(inspection.manifest.system, 'نظام رواسي عدن للهندسة والمقاولات');
  });

  it('4. should list vault items including encryption and cloud status', () => {
    const list = cloudService.listVaultItems();
    assert.ok(Array.isArray(list));
    assert.ok(list.length > 0, 'Vault should contain created archives');
    const first = list[0];
    assert.ok(first.fileName);
    assert.ok(typeof first.encrypted === 'boolean');
  });

  it('5. should test cloud connection and sync archive', async () => {
    const testResult = await cloudService.testCloudConnection({ provider: 'cloud_vault' });
    assert.equal(testResult.success, true);
    assert.equal(testResult.provider, 'cloud_vault');

    const vaultItems = cloudService.listVaultItems();
    if (vaultItems.length > 0) {
      const syncResult = await cloudService.syncArchiveToCloud(vaultItems[0].fileName, { provider: 'cloud_vault' });
      assert.equal(syncResult.success, true);
    }
  });
});
