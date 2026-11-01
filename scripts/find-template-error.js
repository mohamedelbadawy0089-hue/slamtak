// Find template error
const fs = require('fs');

const code = fs.readFileSync('public/app.js', 'utf8');
const errorIndex = code.indexOf('${isIndependentStore ? `');

if (errorIndex !== -1) {
  console.log(`Found template error at position ${errorIndex}`);
  console.log('Context:', code.slice(errorIndex, errorIndex + 200));
}