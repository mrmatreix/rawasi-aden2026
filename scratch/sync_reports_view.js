const fs = require('fs');
const path = require('path');

const viewsReportsPath = path.join(__dirname, '..', 'views', 'reports.html');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const wwwIndexHtmlPath = path.join(__dirname, '..', 'www', 'index.html');

const reportsHtmlContent = fs.readFileSync(viewsReportsPath, 'utf8').trim();

function updateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('File does not exist:', filePath);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  const startTag = '<section id="reportsView" class="app-view-section" style="display: none;">';
  const endTag = '</section>';

  const startIndex = content.indexOf(startTag);
  if (startIndex === -1) {
    console.error('Could not find startTag in', filePath);
    return;
  }

  // Find closing </section> for reportsView (before revenuesView)
  const revenuesIndex = content.indexOf('id="revenuesView"', startIndex);
  if (revenuesIndex === -1) {
    console.error('Could not find revenuesView in', filePath);
    return;
  }

  const endIndex = content.lastIndexOf('</section>', revenuesIndex);
  if (endIndex === -1) {
    console.error('Could not find closing section tag in', filePath);
    return;
  }

  const endTagLen = '</section>'.length;
  const newContent = content.substring(0, startIndex) + reportsHtmlContent + content.substring(endIndex + endTagLen);
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Successfully updated', filePath);
}

updateFile(indexHtmlPath);
updateFile(wwwIndexHtmlPath);
