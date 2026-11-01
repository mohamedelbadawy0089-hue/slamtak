// Check syntax
const fs = require('fs');

try {
  const code = fs.readFileSync('public/app.js', 'utf8');
  new Function(code);
  console.log('Syntax OK');
} catch (e) {
  console.log('Syntax error:', e.message);
}