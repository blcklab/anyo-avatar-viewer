import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../dist/', import.meta.url);
for (const name of await readdir(root)) {
  if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue;
  const text = await readFile(new URL(name, root), 'utf8');
  assert.ok(!/from ['"](?:@blcklab|react|vue|svelte|lit)|document\.|window\.|HTMLCanvasElement/.test(text), `Core boundary violation in ${name}`);
}
await import('../dist/index.js');
console.log('Core import and renderer/framework boundaries verified.');
