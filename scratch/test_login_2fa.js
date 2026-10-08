async function testLogin() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const loginData = await loginRes.json();
  console.log('LOGIN RESPONSE:', loginData);

  if (loginData.requires2FA) {
    const vRes = await fetch('http://localhost:3000/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: loginData.tempToken, code: '654321' })
    });
    console.log('VERIFY 654321:', await vRes.json());
  }
}

testLogin().catch(console.error);
