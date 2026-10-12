import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A local demo server only. It accepts no uploads and makes no outbound requests.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const canonicalRoot = await realpath(root);
const port = Number(process.env.PORT ?? 8784);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png' };

function isWithin(directory, candidate) {
  const path = relative(directory, candidate);
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    // Backslashes are filesystem separators on Windows, never public URL paths.
    if (path.includes('\\') || path.includes('\0')) { res.writeHead(404).end('Not found'); return; }
    if (path === '/') { res.writeHead(302, { Location: '/demo/' }).end(); return; }
    if (!path.startsWith('/demo/') && !path.startsWith('/dist/')) { res.writeHead(404).end('Not found'); return; }
    const directory = path.startsWith('/demo/') ? 'demo' : 'dist';
    const allowedRoot = resolve(root, directory);
    const candidate = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
    if (!isWithin(allowedRoot, candidate)) { res.writeHead(404).end('Not found'); return; }
    const canonicalCandidate = await realpath(candidate);
    if (!isWithin(resolve(canonicalRoot, directory), canonicalCandidate)) { res.writeHead(404).end('Not found'); return; }
    if (!(await stat(canonicalCandidate)).isFile()) { res.writeHead(404).end('Not found'); return; }
    const data = await readFile(canonicalCandidate);
    res.writeHead(200, { 'Content-Type': mime[extname(canonicalCandidate)] ?? 'application/octet-stream', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Browser Video Effects demo: http://127.0.0.1:${port}/demo/\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
