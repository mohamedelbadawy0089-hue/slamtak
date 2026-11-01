#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

const globals = `
  global.window = { location: { pathname: '/', hostname: 'localhost' }, history: { pushState: () => {}, replaceState: () => {} }, addEventListener: () => {}, removeEventListener: () => {}, supabase: { createClient: () => ({ auth: { getSession: () => ({ data: { session: null } }), signUp: () => ({ data: { user: { id: 't' } } }), signInWithPassword: () => ({ data: { user: { id: 't' }, session: { access_token: 't' } } }), signOut: () => ({}) }) }) }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  global.document = { getElementById: () => ({ style: {}, innerHTML: '', appendChild: () => {}, id: '', querySelector: () => null, querySelectorAll: () => [] }), createElement: () => ({ style: {}, innerHTML: '', appendChild: () => {}, id: '', getAttribute: () => null, classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} }), body: { appendChild: () => {} } };
  global.navigator = { userAgent: 'test' };
  global.BigInt = BigInt;`;

let lastGood = 0;
const lines = src.split('\n');
for (let i = 1; i <= lines.length; i++) {
  const code = globals + '\n' + lines.slice(0, i).join('\n') + '\n';
  try {
    new Function(code);
    lastGood = i;
  } catch(e) {
    if (lastGood < i - 1) {
      console.log(`\n=== Error introduced between line ${lastGood} and ${i} ===`);
      for (let j = Math.max(1, lastGood); j <= Math.min(lines.length, i); j++) {
        const marker = j > lastGood ? '>>>' : '   ';
        console.log(marker + ' L' + j + ':', lines[j-1].trim().slice(0, 150));
      }
      process.exit(0);
    }
  }
}
console.log('No syntax error found in template expressions');
