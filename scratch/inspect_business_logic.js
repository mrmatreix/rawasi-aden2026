const fs = require('fs');

console.log('=== 1. Inspecting Accounting Routes ===');
const accRoutes = fs.readFileSync('server/routes/accounting.js', 'utf8');
const routes = accRoutes.match(/router\.(get|post|put|delete)\([^,]+/g) || [];
routes.forEach(r => console.log('  ', r));

console.log('\n=== 2. Checking Journal Entry Creation ===');
const journalMatch = accRoutes.match(/router\.post\(['"]\/journal[\s\S]*?(?=router\.|\n\s*module\.exports)/);
if (journalMatch) {
  console.log(journalMatch[0].substring(0, 700));
}

console.log('\n=== 3. Checking HR Payroll Posting Routes ===');
const hrRoutes = fs.readFileSync('server/routes/hr.js', 'utf8');
const hrEndpoints = hrRoutes.match(/router\.(get|post|put|delete)\([^,]+/g) || [];
hrEndpoints.forEach(r => console.log('  ', r));

console.log('\n=== 4. Checking Tafqeet Implementations ===');
const jsFiles = fs.readdirSync('js');
jsFiles.forEach(f => {
  if (f.endsWith('.js')) {
    const code = fs.readFileSync('js/' + f, 'utf8');
    if (code.includes('tafqeet') || code.includes('تفقيط') || code.includes('Tafqeet')) {
      console.log(`  Found tafqeet reference in js/${f}`);
    }
  }
});
