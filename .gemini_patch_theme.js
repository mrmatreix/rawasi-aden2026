const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Fix print_templates → print in sidebar nav
const before1 = html.includes(`navigateDeep('settings', 'print_templates', this)`);
html = html.replace(
  `navigateDeep('settings', 'print_templates', this)`,
  `navigateDeep('settings', 'print', this)`
);
console.log('Fix print nav:', before1 ? '✅ Fixed' : '⚠️ Already fixed');

// 2. Add theme toggle button - handle CRLF in file
const SEARCH = `<div class="header-actions">`;
const idx = html.indexOf(SEARCH);
if (idx === -1) {
  console.log('❌ Could not find header-actions div');
  process.exit(1);
}

// Find the end of the opening div tag
const insertIdx = idx + SEARCH.length;

// Build the theme toggle HTML to insert right after opening div
const THEME_TOGGLE = `
      <!-- زر تبديل الوضع الليلي/النهاري -->
      <button class="theme-toggle-btn" id="btnThemeToggle" onclick="App.toggleTheme()" title="تبديل الوضع الليلي والنهاري" aria-label="تبديل المظهر">
        <span class="theme-icon-dark">🌙</span>
        <span class="theme-icon-light">☀️</span>
        <span class="theme-toggle-label" id="themeToggleLabel">ليلي</span>
      </button>
`;

// Check if already added
if (html.includes('theme-toggle-btn')) {
  console.log('⚠️ Theme toggle already present in HTML');
} else {
  html = html.substring(0, insertIdx) + THEME_TOGGLE + html.substring(insertIdx);
  console.log('✅ Theme toggle button inserted at position:', insertIdx);
}

fs.writeFileSync('index.html', html, 'utf8');
console.log('✅ index.html patched and saved');
