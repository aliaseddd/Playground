// `npm start`: serves dist/stronghold.html at http://localhost:8080 (or $PORT) on this computer
// only. Stops with Ctrl+C. Nothing else is needed; records live in the browser that opens it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../dist/stronghold.html', import.meta.url));
const port = Number(process.env.PORT) || 8080;

let page;
try {
  page = await readFile(file);
} catch {
  console.error('dist/stronghold.html is missing. Run `npm install` and `npm run build` first.');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html' && url.pathname !== '/stronghold.html') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found. Stronghold is at /\n');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : page);
}).listen(port, '127.0.0.1', () => {
  console.log(`Stronghold is running at http://localhost:${port}  (Ctrl+C to stop)`);
});
