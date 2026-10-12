import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

async function availablePort() {
  const reserve = createServer();
  await new Promise((accept, reject) => {
    reserve.once('error', reject);
    reserve.listen(0, '127.0.0.1', accept);
  });
  const port = reserve.address().port;
  await new Promise((accept, reject) => reserve.close(error => error ? reject(error) : accept()));
  return port;
}

function getResponse(port, path, method = 'GET') {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('Local demo server did not respond.')));
    req.on('error', reject);
    req.end();
  });
}

async function removeFixture(directory) {
  // These are the exact temporary directories created by this test, never project paths.
  const canonical = await realpath(directory);
  const temporaryRoot = await realpath(tmpdir());
  assert.equal(dirname(canonical).toLowerCase(), temporaryRoot.toLowerCase());
  assert.ok(basename(canonical).startsWith('browser-video-effects-serve-'));
  await rm(canonical, { recursive: true, force: true });
}

test('local demo server confines routes and symlinks to their corresponding public directory', { timeout: 20000 }, async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'browser-video-effects-serve-'));
  const outside = await mkdtemp(join(tmpdir(), 'browser-video-effects-serve-'));
  let child;
  let exited;
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    await removeFixture(fixture);
    await removeFixture(outside);
  });
  await Promise.all(['scripts', 'demo', 'dist'].map(name => mkdir(join(fixture, name))));
  await copyFile(new URL('../scripts/serve.mjs', import.meta.url), join(fixture, 'scripts', 'serve.mjs'));
  await Promise.all([
    writeFile(join(fixture, 'demo', 'index.html'), '<h1>Public demo fixture</h1>'),
    writeFile(join(fixture, 'dist', 'index.js'), 'export const fixture = true;'),
    writeFile(join(fixture, 'package.json'), '{"private":true,"fixture":true}'),
    writeFile(join(fixture, '.env'), 'Non-sensitive test fixture; never served.'),
    writeFile(join(outside, 'fixture.txt'), 'Non-sensitive external fixture; never served.'),
  ]);
  await symlink(outside, join(fixture, 'demo', 'outside'), 'junction');
  await symlink(join(fixture, 'dist'), join(fixture, 'demo', 'cross-directory'), 'junction');

  const port = await availablePort();
  child = spawn(process.execPath, [join(fixture, 'scripts', 'serve.mjs')], {
    env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = new Promise(accept => child.once('exit', accept));
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Local demo server startup timed out.')), 5000);
    let output = '';
    const finish = error => { clearTimeout(timer); child.removeListener('error', onError); child.removeListener('exit', onExit); error ? reject(error) : accept(); };
    const onError = error => finish(error);
    const onExit = () => finish(new Error('Local demo server exited during startup.'));
    child.once('error', onError); child.once('exit', onExit);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes(`:${port}/demo/`)) finish(); });
  });

  await t.test('normal public GET, HEAD and root redirect work', async () => {
    const demo = await getResponse(port, '/demo/');
    assert.equal(demo.status, 200); assert.match(demo.body, /Public demo fixture/u);
    assert.match(demo.headers['content-type'], /^text\/html/u);
    const runtime = await getResponse(port, '/dist/index.js');
    assert.equal(runtime.status, 200); assert.match(runtime.body, /fixture = true/u);
    assert.match(runtime.headers['content-type'], /^text\/javascript/u);
    const head = await getResponse(port, '/demo/index.html', 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, ''); assert.ok(Number(head.headers['content-length']) > 0);
    const root = await getResponse(port, '/');
    assert.equal(root.status, 302); assert.equal(root.headers.location, '/demo/');
  });
  await t.test('encoded separators, traversal, NUL and root files stay unavailable', async () => {
    for (const path of [
      '/package.json', '/.env', '/demo/../package.json', '/demo/..%5Cpackage.json', '/demo/%2e%2e%5c.env',
      '/demo/%2e%2e%2fpackage.json', '/dist/..%2f.env', '/demo/..%2f..%2fpackage.json', '/demo/%00index.html', '/demo/%ZZindex.html',
    ]) assert.equal((await getResponse(port, path)).status, 404, path);
  });
  await t.test('symlinks cannot cross the allowed directory boundary', async () => {
    assert.equal((await getResponse(port, '/demo/outside/fixture.txt')).status, 404);
    assert.equal((await getResponse(port, '/demo/cross-directory/index.js')).status, 404);
  });
  await t.test('upload and other non-read methods are refused', async () => {
    const post = await getResponse(port, '/demo/', 'POST');
    assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
  });
});
