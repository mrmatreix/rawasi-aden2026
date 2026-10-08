const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const scheduler = require('../../server/services/backupSchedulerService');

test('Automated Backup Scheduler Test Suite', async (t) => {
  await t.test('1. Scheduler initialization and default status', async () => {
    await scheduler.init();
    const status = scheduler.getStatus();

    assert.ok(status, 'Status object should exist');
    assert.strictEqual(typeof status.enabled, 'boolean', 'Enabled should be boolean');
    assert.ok(['daily', 'weekly'].includes(status.interval), 'Interval should be daily or weekly');
    assert.ok(status.storagePath, 'Storage path should be defined');
    assert.strictEqual(status.storagePathExists, true, 'Storage path should exist');
    assert.strictEqual(status.storagePathWritable, true, 'Storage path should be writable');
  });

  await t.test('2. Configure daily vs weekly intervals and custom storage path', async () => {
    const testCustomDir = path.resolve(__dirname, '..', '..', 'server', 'database', 'backups', 'test_custom_dir');
    
    // Test custom path validation
    const pathTest = scheduler.testStoragePath(testCustomDir);
    assert.strictEqual(pathTest.success, true, 'Should successfully test and create custom storage path');

    // Save daily config
    const dailyStatus = await scheduler.saveConfig({
      enabled: true,
      interval: 'daily',
      time: '03:30',
      storagePath: testCustomDir,
      maxFiles: 5
    }, 'test_runner');

    assert.strictEqual(dailyStatus.enabled, true);
    assert.strictEqual(dailyStatus.interval, 'daily');
    assert.strictEqual(dailyStatus.time, '03:30');
    assert.strictEqual(dailyStatus.storagePath, testCustomDir);
    assert.strictEqual(dailyStatus.maxFiles, 5);

    // Save weekly config
    const weeklyStatus = await scheduler.saveConfig({
      enabled: true,
      interval: 'weekly',
      dayOfWeek: 4, // Thursday
      time: '04:00',
      storagePath: testCustomDir,
      maxFiles: 4
    }, 'test_runner');

    assert.strictEqual(weeklyStatus.interval, 'weekly');
    assert.strictEqual(weeklyStatus.dayOfWeek, 4);
    assert.strictEqual(weeklyStatus.time, '04:00');
  });

  await t.test('3. Execute automatic backup to custom storage path and verify file', async () => {
    const testCustomDir = path.resolve(__dirname, '..', '..', 'server', 'database', 'backups', 'test_custom_dir');
    
    const result = await scheduler.executeBackup('test_trigger', 'admin');
    assert.strictEqual(result.success, true, 'Backup execution should report success');
    assert.ok(result.fileName.startsWith('backup_auto_'), 'Filename should have backup_auto_ prefix');
    assert.ok(fs.existsSync(result.filePath), 'File should exist on disk at configured path');
    assert.ok(result.fileSize > 0, 'File size should be greater than 0');

    const statusAfter = scheduler.getStatus();
    assert.strictEqual(statusAfter.lastStatus, 'success');
    assert.strictEqual(statusAfter.lastFile, result.fileName);
    assert.strictEqual(statusAfter.lastSize, result.fileSize);
  });

  await t.test('4. Retention policy pruning when maxFiles is exceeded', async () => {
    const testCustomDir = path.resolve(__dirname, '..', '..', 'server', 'database', 'backups', 'test_custom_dir');
    
    // Set maxFiles to 2
    await scheduler.saveConfig({
      storagePath: testCustomDir,
      maxFiles: 2
    });

    // Create 3 dummy auto backup files with older timestamps
    const file1 = path.join(testCustomDir, 'backup_auto_daily_2026-09-01_10-00-00.db');
    const file2 = path.join(testCustomDir, 'backup_auto_daily_2026-09-02_10-00-00.db');
    const file3 = path.join(testCustomDir, 'backup_auto_daily_2026-09-03_10-00-00.db');

    const now = Date.now();
    fs.writeFileSync(file1, 'backup1');
    fs.utimesSync(file1, (now - 300000) / 1000, (now - 300000) / 1000);

    fs.writeFileSync(file2, 'backup2');
    fs.utimesSync(file2, (now - 200000) / 1000, (now - 200000) / 1000);

    fs.writeFileSync(file3, 'backup3');
    fs.utimesSync(file3, (now - 100000) / 1000, (now - 100000) / 1000);

    scheduler.pruneOldBackups(testCustomDir, 2);

    // Oldest file should be pruned
    assert.strictEqual(fs.existsSync(file1), false, 'Oldest file should have been deleted');

    // Clean up test directory
    try {
      if (fs.existsSync(file2)) fs.unlinkSync(file2);
      if (fs.existsSync(file3)) fs.unlinkSync(file3);
      const remaining = fs.readdirSync(testCustomDir);
      remaining.forEach(f => {
        try { fs.unlinkSync(path.join(testCustomDir, f)); } catch {}
      });
      fs.rmdirSync(testCustomDir);
    } catch {}
  });

  await t.test('5. Restore default configuration', async () => {
    const defaultStatus = await scheduler.saveConfig({
      enabled: true,
      interval: 'daily',
      time: '02:00',
      dayOfWeek: 5,
      storagePath: scheduler.defaultStoragePath,
      maxFiles: 14
    });

    assert.strictEqual(defaultStatus.enabled, true);
    assert.strictEqual(defaultStatus.interval, 'daily');
    assert.strictEqual(defaultStatus.time, '02:00');
    assert.strictEqual(defaultStatus.storagePath, scheduler.defaultStoragePath);

    scheduler.stop();
  });
});
