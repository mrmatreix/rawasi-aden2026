const test = require('node:test');
const assert = require('node:assert/strict');
const tafqeet = require('../../server/services/tafqeetService');

test('Tafqeet Service - Basic Integer Currency Conversion', () => {
  const res1 = tafqeet.tafqeet(100, 'YER');
  assert.ok(res1.includes('مائة') && res1.includes('ريال'), `Expected 100 YER to contain 'مائة ريال', got: ${res1}`);

  const res2 = tafqeet.tafqeet(1000, 'SAR');
  assert.ok(res2.includes('ألف') && res2.includes('سعودي'), `Expected 1000 SAR to contain 'ألف ريال سعودي', got: ${res2}`);

  const res3 = tafqeet.tafqeet(1000000, 'USD');
  assert.ok(res3.includes('مليون') && res3.includes('دولار'), `Expected 1,000,000 USD to contain 'مليون دولار', got: ${res3}`);
});

test('Tafqeet Service - Fractional & Decimal Precision', () => {
  const res = tafqeet.tafqeet(450.75, 'USD');
  assert.ok(res.includes('أربعمائة') && res.includes('خمسون دولاراً') && res.includes('خمسة وسبعون سنتاً'),
    `Expected decimal precision for USD, got: ${res}`);

  const resYer = tafqeet.tafqeet(1200.50, 'YER');
  assert.ok(resYer.includes('ألف ومائتان') && resYer.includes('فلس'), `Expected fils for YER fraction, got: ${resYer}`);
});

test('Tafqeet Service - Edge Cases', () => {
  const resZero = tafqeet.tafqeet(0, 'YER');
  assert.strictEqual(resZero, 'صفر ريال يمني');

  const resNull = tafqeet.tafqeet(null);
  assert.strictEqual(resNull, 'صفر');
});
