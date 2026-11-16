const fs = require('node:fs');
const path = require('node:path');
const { isServiceRoleKey } = require('./supabase-key.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');

function readEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected one ${label} entry in index.html.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const fileEnv = readEnv(path.join(root, '.env'));
const supabaseUrl = process.env.ROUNDS_SUPABASE_URL || fileEnv.ROUNDS_SUPABASE_URL || '';
const publishableKey = process.env.ROUNDS_SUPABASE_PUBLISHABLE_KEY || fileEnv.ROUNDS_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !publishableKey) {
  throw new Error('Set ROUNDS_SUPABASE_URL and ROUNDS_SUPABASE_PUBLISHABLE_KEY in .env or the build environment.');
}
if (isServiceRoleKey(publishableKey)) {
  throw new Error('A service-role key cannot be included in a browser build. Use the Supabase publishable key.');
}
try {
  const parsedUrl = new URL(supabaseUrl);
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw new Error();
} catch {
  throw new Error('ROUNDS_SUPABASE_URL must be a valid HTTP or HTTPS URL.');
}

const files = ['index.html', 'app.js', 'theme-init.js', 'styles.css', 'supabase-client.js'];
for (const name of files) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Required browser source is missing: ${name}`);
}

const vendors = [
  [
    path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
    path.join(output, 'vendor', 'supabase.js')
  ],
  [
    path.join(root, 'node_modules', 'read-excel-file', 'bundle', 'read-excel-file.min.js'),
    path.join(output, 'vendor', 'read-excel-file.min.js')
  ],
  [
    path.join(root, 'node_modules', 'write-excel-file', 'bundle', 'write-excel-file.min.js'),
    path.join(output, 'vendor', 'write-excel-file.min.js')
  ]
];
for (const [source] of vendors) {
  if (!fs.existsSync(source)) throw new Error(`Required browser dependency is missing: ${path.relative(root, source)}. Run npm install first.`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const name of files) fs.copyFileSync(path.join(root, name), path.join(output, name));
for (const [source, destination] of vendors) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const config = `window.roundsConfig = Object.freeze(${JSON.stringify({
  supabaseUrl,
  supabasePublishableKey: publishableKey
})});\n`;
fs.writeFileSync(path.join(output, 'rounds-config.js'), config);

let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
html = replaceOnce(
  html,
  '<script defer src="./node_modules/@supabase/supabase-js/dist/umd/supabase.js"></script>',
  '<script defer src="./vendor/supabase.js"></script>',
  'Supabase SDK'
);
html = replaceOnce(
  html,
  '<script defer src="./node_modules/read-excel-file/bundle/read-excel-file.min.js"></script>',
  '<script defer src="./vendor/read-excel-file.min.js"></script>',
  'XLSX reader'
);
html = replaceOnce(
  html,
  '<script defer src="./node_modules/write-excel-file/bundle/write-excel-file.min.js"></script>',
  '<script defer src="./vendor/write-excel-file.min.js"></script>',
  'XLSX writer'
);
html = replaceOnce(
  html,
  '<script defer src="./supabase-client.js"></script>',
  '<script defer src="./rounds-config.js"></script>\n  <script defer src="./supabase-client.js"></script>',
  'Supabase client'
);
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, '.nojekyll'), '');

console.log(`Browser build created in ${path.relative(root, output)}.`);
