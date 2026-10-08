const path = require('path');
const { query } = require('../server/database/db');

async function main() {
  const users = await query('SELECT id, username, role, two_factor_pin, two_factor_enabled FROM users');
  console.log('USERS:', users);

  const settings = await query("SELECT * FROM settings WHERE key LIKE '%pin%' OR key LIKE '%2fa%'");
  console.log('SETTINGS:', settings);
}

main().catch(console.error);
