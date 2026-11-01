"use strict";
const fs = require('fs');
const { parse } = require('@babel/parser');
const generate = require('@babel/generator').default;

const code = fs.readFileSync('public/app.js', 'utf8');

try {
  const ast = parse(code, {
    sourceType: 'script',
    plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator']
  });
  
  console.log('Parsing successful!');
  
  const output = generate(ast, {}, code).code;
  
  fs.writeFileSync('public/app.js', output);
  console.log('Fixed code written!');
  
} catch (e) {
  console.log('Parse error:', e.message);
  if (e.loc) {
    console.log('Location:', e.loc);
  }
}