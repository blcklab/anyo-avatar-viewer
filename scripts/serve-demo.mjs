import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sekai = dirname(fileURLToPath(import.meta.resolve('@blcklab/sekai64')));
const avatar = resolve(dirname(fileURLToPath(import.meta.resolve('@blcklab/anyo-avatar/vrm'))), '..');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let base = root, path = decodeURIComponent(url.pathname);
    if (path.startsWith('/vendor/sekai64/')) { base = sekai; path = path.slice('/vendor/sekai64'.length); }
    else if (path.startsWith('/vendor/anyo-avatar/')) { base = avatar; path = path.slice('/vendor/anyo-avatar'.length); }
    else if (path === '/') path = '/examples/browser/index.html';
    const filename = resolve(base, '.' + path);
    if (!filename.startsWith(resolve(base) + sep)) throw Error('Invalid path');
    if (!(await stat(filename)).isFile()) throw Error('Not a file');
    response.setHeader('Content-Type', filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(await readFile(filename));
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`Avatar viewer demo: http://127.0.0.1:${server.address().port}`));
