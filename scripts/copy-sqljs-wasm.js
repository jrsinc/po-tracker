// Copies the sql.js WebAssembly binary into public/ so the web build serves it at
// /sql-wasm-browser.wasm (see src/db/expoDriver.web.ts). npm runs this from the project
// root on `npm install` (postinstall).
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const src = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm-browser.wasm');
const dest = path.join(root, 'public', 'sql-wasm-browser.wasm');
if (!fs.existsSync(src)) {
  console.warn('sql.js not installed; skipping wasm copy');
} else {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('Copied sql.js wasm to public/');
}
