import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.ok(pkg.exports?.['./browser'], 'Missing first-class ./browser export.');
assert.equal(pkg.exports['./browser'].import, './dist/browser.js');
assert.equal(pkg.exports['./browser'].types, './dist/browser.d.ts');
for (const group of ['dependencies', 'peerDependencies']) {
  for (const name of Object.keys(pkg[group] ?? {})) {
    assert.ok(!/^(?:vue|react|react-dom|svelte|lit)(?:$|\/)/.test(name), `Framework dependency leaked into ${group}: ${name}`);
  }
}

const frameworkImport = /(?:from\s+['\"]|import\s*\(\s*['\"]|import\s+['\"])(?:vue|react|react-dom|svelte|lit)(?:\/|['\"])/;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) { await scan(url); continue; }
    if (!/\.(?:ts|js|mjs)$/.test(entry.name)) continue;
    const text = await readFile(url, 'utf8');
    assert.ok(!frameworkImport.test(text), `Framework import leaked into core package: ${url.pathname}`);
  }
}
await scan(new URL('src/', root));
await scan(new URL('dist/', root));

const demo = new URL('examples/browser/demo.js', root);
const syntax = spawnSync(process.execPath, ['--check', demo.pathname], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'Vanilla demo syntax check failed.');
const demoText = await readFile(demo, 'utf8');
assert.match(demoText, /@blcklab\/anyo-avatar-viewer\/browser/);
assert.ok(!/\b(?:Vue|React|Svelte|Lit)\b/.test(demoText), 'Vanilla demo must not depend on a framework.');

// Root controller remains safe for SSR/non-DOM consumers.
await import('../dist/index.js');
console.log('Vanilla JavaScript/browser contract verified.');
