const fs = require('node:fs');
const path = require('node:path');
const { isServiceRoleKey } = require('../scripts/supabase-key.cjs');

const root = path.resolve(__dirname, '..');
const webDir = path.join(__dirname, 'www');

function readEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = readEnv(path.join(root, '.env'));
const supabaseUrl = process.env.ROUNDS_SUPABASE_URL || env.ROUNDS_SUPABASE_URL || '';
const publishableKey = process.env.ROUNDS_SUPABASE_PUBLISHABLE_KEY || env.ROUNDS_SUPABASE_PUBLISHABLE_KEY || '';
if (!supabaseUrl || !publishableKey) {
  throw new Error('Set ROUNDS_SUPABASE_URL and ROUNDS_SUPABASE_PUBLISHABLE_KEY in .env before building the Android app.');
}
if (isServiceRoleKey(publishableKey)) {
  throw new Error('A Supabase secret or service-role key cannot be included in an Android app. Use the publishable key.');
}

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
for (const name of ['index.html', 'app.js', 'theme-init.js', 'styles.css', 'supabase-client.js']) {
  fs.copyFileSync(path.join(root, name), path.join(webDir, name));
}

const supabaseBundle = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const readExcelBundle = path.join(root, 'node_modules', 'read-excel-file', 'bundle', 'read-excel-file.min.js');
const writeExcelBundle = path.join(root, 'node_modules', 'write-excel-file', 'bundle', 'write-excel-file.min.js');
for (const [source, destination] of [
  [supabaseBundle, path.join(webDir, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js')],
  [readExcelBundle, path.join(webDir, 'node_modules', 'read-excel-file', 'bundle', 'read-excel-file.min.js')],
  [writeExcelBundle, path.join(webDir, 'node_modules', 'write-excel-file', 'bundle', 'write-excel-file.min.js')]
]) {
  if (!fs.existsSync(source)) throw new Error(`Required web dependency is missing: ${path.relative(root, source)}. Run npm install first.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

fs.writeFileSync(path.join(webDir, 'mobile-config.js'), `window.roundsConfig = Object.freeze(${JSON.stringify({
  supabaseUrl,
  supabasePublishableKey: publishableKey
})});\n`);

const indexPath = path.join(webDir, 'index.html');
const index = fs.readFileSync(indexPath, 'utf8');
fs.writeFileSync(indexPath, index.replace(
  '<script defer src="./supabase-client.js"></script>',
  '<script defer src="./mobile-config.js"></script>\n  <script defer src="./supabase-client.js"></script>'
));
