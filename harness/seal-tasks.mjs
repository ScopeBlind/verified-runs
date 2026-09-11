#!/usr/bin/env node
/**
 * Seal a task set: fetch the named tasks from the benchmark repository at a
 * pinned commit, write an encrypted archive of every task file except the
 * reference solution, and write the public pin beside it (paths, hashes, and
 * the task-set digest, never the contents).
 *
 *   SEALED_TASKS_KEY=<64 hex> node scripts/seal-tasks.mjs --tasks a,b --revision <sha> --out task-sets/name
 *
 * Without SEALED_TASKS_KEY a fresh key is generated and printed to stderr once.
 * The archive is AES-256-GCM over a JSON body; the pin is what a verifier
 * checks a run against; the key is what a maintainer keeps.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const core = await import(pathToFileURL(resolve(here, '../verify/legate-run.core.mjs')).href);
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const ids = flag('--tasks', '').split(',').map((s) => s.trim()).filter(Boolean);
const revision = flag('--revision', '');
const out = resolve(flag('--out', ''));
const name = flag('--name', 'terminal-bench/original-tasks');
if (!ids.length || !revision || !flag('--out', '')) { console.error('usage: seal-tasks.mjs --tasks a,b --revision <sha> --out <path-without-extension> [--name <set name>]'); process.exit(2); }

const gh = (path) => { const r = spawnSync('gh', ['api', path], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`gh api ${path}: ${r.stderr}`); return JSON.parse(r.stdout); };
const isSolution = (path) => /^solution(\.|$)/.test(path.split('/').pop());
const digestOf = (buf) => createHash('sha256').update(buf).digest('hex');

const tasks = [];
for (const id of ids) {
  const listing = gh(`repos/laude-institute/terminal-bench/contents/original-tasks/${id}?ref=${revision}`);
  const entries = [];
  for (const e of listing) {
    if (e.type === 'file') entries.push({ path: e.name, sha: e.sha });
    else if (e.type === 'dir') for (const b of gh(`repos/laude-institute/terminal-bench/git/trees/${e.sha}?recursive=1`).tree) if (b.type === 'blob') entries.push({ path: `${e.name}/${b.path}`, sha: b.sha });
  }
  const files = {};
  for (const { path, sha } of entries) if (!isSolution(path)) files[path] = Buffer.from(gh(`repos/laude-institute/terminal-bench/git/blobs/${sha}`).content, 'base64').toString('base64');
  tasks.push({ id, files });
  console.error(`  sealed ${id}: ${Object.keys(files).length} files`);
}
const pinTasks = tasks.map((t) => ({ id: t.id, files: Object.entries(t.files).map(([path, b64]) => ({ path, sha256: digestOf(Buffer.from(b64, 'base64')) })).sort((a, b) => (a.path < b.path ? -1 : 1)) }));
const digest = core.taskSetDigest(name, revision, pinTasks);
const key = process.env.SEALED_TASKS_KEY ? Buffer.from(process.env.SEALED_TASKS_KEY, 'hex') : randomBytes(32);
if (key.length !== 32) { console.error('SEALED_TASKS_KEY must be 32 bytes as hex'); process.exit(2); }
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.from(JSON.stringify({ name, revision, tasks }), 'utf8');
const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
const sealed = { type: 'legate.sealed_task_set.v1', name, revision, digest, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.sealed.json`, `${JSON.stringify(sealed, null, 2)}\n`);
writeFileSync(`${out}.pin.json`, `${JSON.stringify({ type: 'legate.task_set_pin.v1', name, source: 'https://github.com/laude-institute/terminal-bench', revision, rule: 'Every file in the task directory except the reference solution, which is never fetched. Contents are sealed; only paths and hashes are public.', tasks: pinTasks, digest }, null, 2)}\n`);
if (!process.env.SEALED_TASKS_KEY) console.error(`SEALED_TASKS_KEY=${key.toString('hex')}  (generated once; keep it, it is not stored anywhere)`);
console.log(`${out}.sealed.json and ${out}.pin.json written; task-set digest ${digest}`);
