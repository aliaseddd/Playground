// Builds Stronghold into single self-contained HTML files in dist/:
//   stronghold.html           a complete page: open it in a browser, or serve it with `npm start`
//   stronghold-artifact.html  the same page without the document skeleton, for the Claude viewer
import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

const pkg = JSON.parse(await readFile(path('package.json'), 'utf8'));
const { APP_VERSION } = await import(new URL('src/core/version.js', root));
if (APP_VERSION !== pkg.version) {
  console.error(`src/core/version.js says ${APP_VERSION} but package.json says ${pkg.version}. Make them the same.`);
  process.exit(1);
}

const bundle = await build({
  entryPoints: [path('src/web/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome105', 'edge105', 'firefox110', 'safari16'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  write: false,
});
// A closing script tag inside the code would end the inline <script> early.
const js = bundle.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1');
const css = (await transform(await readFile(path('src/web/styles.css'), 'utf8'), { loader: 'css', minify: true })).code;

const description = 'Stronghold signs visitors and contractors in and out at the front desk, screens each one against a watchlist before admission, prints badges and keeps a searchable visit history.';
const body = `<title>Stronghold</title>
<meta name="description" content="${description}">
<style>${css}</style>
<div id="app"></div>
<noscript>Stronghold needs JavaScript. Turn it on for this page and reload.</noscript>
<script>${js}</script>
`;
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${body.replace('<div id="app"></div>', '</head>\n<body>\n<div id="app"></div>')}</body>
</html>
`;

await mkdir(path('dist'), { recursive: true });
await writeFile(path('dist/stronghold.html'), standalone);
await writeFile(path('dist/stronghold-artifact.html'), body);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`Built Stronghold ${pkg.version}: dist/stronghold.html (${kb(standalone)}), dist/stronghold-artifact.html (${kb(body)})`);
