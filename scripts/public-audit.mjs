import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// A bounded pre-publication check, not a substitute for inspecting every public file.
const root = fileURLToPath(new URL('../', import.meta.url));
const skipped = new Set(['node_modules', 'dist', '.git']);
const secretPatterns = [
  ['private-key', /-----BEGIN (?:(?:RSA|EC|OPENSSH) )?PRIVATE KEY-----/u],
  ['github-classic-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u],
  ['api-secret-token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/u],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ['credential-assignment', /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-.]{24,}["']/iu],
  ['advertising-account', /\bca-pub-\d{12,}\b/u],
  ['local-user-path', /[A-Z]:[\\/](?:Users|lagoslife\.party)[\\/]/iu],
];
const forbiddenFiles = /^(?:\.env(?:\..*)?|wrangler\.(?:jsonc?|toml)|site-services\.json|monitor-config\.json|launch-status\.json|.*\.(?:pem|key|pfx|p12))$/iu;
const files = [];
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const full = join(directory, entry.name);
    const path = relative(root, full).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) { findings.push({ file: path, rule: 'unexpected-symlink' }); continue; }
    if (entry.isDirectory()) { await walk(full); continue; }
    const bytes = await readFile(full);
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    if (forbiddenFiles.test(entry.name)) findings.push({ file: path, rule: 'private-file' });
    if (/\.(?:mp4|webm|png|jpe?g)$/iu.test(path)) continue;
    const source = bytes.toString('utf8');
    for (const [rule, pattern] of secretPatterns) if (pattern.test(source)) findings.push({ file: path, rule });
  }
}
await walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const compiledSource = await readFile(new URL('../src/renderer.ts', import.meta.url), 'utf8');
if (/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/u.test(compiledSource)) findings.push({ file: 'src/renderer.ts', rule: 'unexpected-network-request' });
if (/https?:\/\//u.test(compiledSource)) findings.push({ file: 'src/renderer.ts', rule: 'unexpected-network-url' });
const report = { status: findings.length ? 'FAIL' : 'PASS', fileCount: files.length, secretPatternCount: secretPatterns.length, findings, files };
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (findings.length) process.exitCode = 1;
