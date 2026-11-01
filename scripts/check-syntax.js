#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
let src = fs.readFileSync(APP_JS, 'utf8');

// Wrap with browser globals
const wrapped = `
  global.window = {
    location: { pathname: '/', hostname: 'localhost' },
    history: { pushState: () => {}, replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    supabase: { createClient: () => ({
      auth: {
        getSession: () => ({ data: { session: null } }),
        signUp: () => ({ data: { user: { id: 'test' } } }),
        signInWithPassword: () => ({ data: { user: { id: 'test' }, session: { access_token: 't' } } }),
        signOut: () => ({})
      }
    }) },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  global.document = {
    getElementById: () => ({ style: {}, innerHTML: '', appendChild: () => {}, id: '', querySelector: () => null, querySelectorAll: () => [] }),
    createElement: () => ({ style: {}, innerHTML: '', appendChild: () => {}, id: '', getAttribute: () => null, classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} }),
    body: { appendChild: () => {} }
  };
  global.navigator = { userAgent: 'test' };
  global.BigInt = BigInt;
  ${src}
`;

try {
  new Function(wrapped);
  console.log('✅ app.js syntax OK with browser shims');
} catch(e) {
  console.log('❌ Error:', e.toString());
  if (e.stack) {
    const match = e.stack.match(/evalmachine\.<anonymous>:(\d+)/);
    if (match) {
      const wrappedLine = parseInt(match[1]) - 1;
      const lines = wrapped.split('\n');
      const originalLine = wrappedLine - 8;
      console.log('Original line ~', originalLine + 1);
      for (let i = Math.max(0, originalLine-3); i <= Math.min(lines.length-8, originalLine+3); i++) {
        const marker = i === originalLine ? '>>>' : '   ';
        const lineContent = lines[i+8];
        console.log(marker, 'L' + (i+1) + ':', lineContent?.trim().slice(0, 150));
      }
    }
  }
}
