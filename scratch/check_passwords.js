const bcrypt = require('bcryptjs');
const { query } = require('../server/database/db');

async function checkUsers() {
  const users = await query('SELECT id, username, full_name, role, password_hash, two_factor_pin, two_factor_enabled FROM users');
  for (const u of users) {
    const isPassAdmin123 = bcrypt.compareSync('admin123', u.password_hash);
    const isPassAdmin = bcrypt.compareSync('admin', u.password_hash);
    const isPass123456 = bcrypt.compareSync('123456', u.password_hash);
    console.log(`User: ${u.username} (${u.full_name}) | role: ${u.role} | PIN: ${u.two_factor_pin} | 2FA enabled: ${u.two_factor_enabled}`);
    console.log(`  matches 'admin123': ${isPassAdmin123} | matches 'admin': ${isPassAdmin} | matches '123456': ${isPass123456}`);
  }
}

checkUsers().catch(console.error);
