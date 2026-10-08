const { spawn, exec } = require('child_process');
const http = require('http');

console.log('=============================================================');
console.log('   🚀 نظام رواسي عدن - جاري تشغيل النظام والبث المباشر');
console.log('=============================================================');

// 1. التأكد من تشغيل السيرفر المحلي
function checkServer(callback) {
  const req = http.get('http://localhost:5500/api/health', (res) => {
    callback(true);
  });
  req.on('error', () => callback(false));
  req.setTimeout(1500, () => { req.destroy(); callback(false); });
}

checkServer((isRunning) => {
  if (!isRunning) {
    console.log('[*] جاري تشغيل خادم Node.js الداخلي...');
    spawn('node', ['server/server.js'], { stdio: 'ignore', detached: true });
  } else {
    console.log('[*] خادم النظام الداخلي يعمل بالفعل (Port 5500).');
  }

  // 2. تشغيل نفق Cloudflare واستخراج الرابط تلقائياً
  console.log('[*] جاري الاتصال بشبكة Cloudflare العالمية...');
  const cf = spawn('.\\cloudflared.exe', ['tunnel', '--url', 'http://localhost:5500']);

  let foundUrl = false;

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !foundUrl) {
      foundUrl = true;
      const url = match[0];
      console.log('\n=============================================================');
      console.log('  🎉 تم توليد رابط النظام العالمي بنجاح!');
      console.log('  🌐 رابط مشروعك المباشر:');
      console.log(`  👉  ${url}  👈`);
      console.log('=============================================================');
      console.log('ℹ️ يمكنك نسخ الرابط أعلاه وفتحه من هاتفك أو إرساله لأي شخص.');
      console.log('⚠️ ملاحظة: اترك هذه الشاشة مفتوحة طالما أنك تستخدم النظام.\n');
      console.log('[*] جاري فتح الرابط في المتصفح تلقائياً الآن...');
      exec(`start ${url}`);
    }
  };

  cf.stdout.on('data', handleOutput);
  cf.stderr.on('data', handleOutput);

  cf.on('close', (code) => {
    console.log('تم إيقاف اتصال Cloudflare.');
  });
});
