#!/usr/bin/env node
/**
 * The adversarial suite: every way we can name to present a verified run that
 * did not happen as claimed, applied in memory to the committed run, each
 * asserted to fail the check that names it. A mutation the verifier accepts is
 * a hole, and the suite fails until the verifier closes it.
 *
 * The demonstration keys are public, so an attacker with them can re-sign
 * anything; this suite therefore exercises the verifier's logic, and the
 * README beside every run says what the demo keys do and do not prove.
 *
 *   node scripts/check-verified-run-adversarial.mjs [samples/verified-run]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The run to attack: given on the command line, else the first run under ./runs (public repository) or the monorepo's committed run.
import { existsSync, readdirSync } from 'node:fs';
const firstRun = (base) => (existsSync(base) ? readdirSync(base).map((n) => join(base, n)).find((d) => existsSync(join(d, 'manifest.json'))) : null);
const dir = resolve(process.argv[2] ?? firstRun(join(web, 'runs')) ?? resolve(web, '../samples/verified-run'));
const m = await import(pathToFileURL(join(web, 'verify/legate-run.core.mjs')).href);
const read = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const NOW = new Date('2026-09-12T00:00:00Z');

const standard = read('standard.json');
const manifest = read('manifest.json');
const receipts = m.parseReceiptLog(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')).receipts;
const clone = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
/** A mutation must leave the run unbound and fail the named check (or fail to verify at all). */
function caught(name, mutate, expectCheck) {
  const ctx = { standard: clone(standard), receipts: clone(receipts), manifest: clone(manifest) };
  mutate(ctx);
  const v = m.verifyRunManifest(ctx.manifest, { standard: ctx.standard, receipts: ctx.receipts }, NOW);
  const failed = v.checks.filter((c) => !c.ok && !c.informational).map((c) => c.id);
  const okCond = v.binding !== 'bound' && (expectCheck === null || failed.some((id) => expectCheck.test(id)));
  assert.ok(okCond, `${name}: verifier accepted it (binding=${v.binding}, failed=[${failed.join(', ')}])`);
  passed++; console.log(`  ✓ caught: ${name} (${failed.slice(0, 3).join(', ') || v.binding})`);
}

const signer = m.runSignerFromSeed('legate-verified-run', 'Legate verified-run harness (demo)');
const gateway = { priv: m.GATEWAY_DEMO_SEED };
const resign = (mf) => {
  const { type, version, run_id, standard: s, agent, harness, dataset, environment, gateway: g, attempts, summary, signer: sg, issued_at, nonce } = mf;
  return m.createRunManifest({ standard: s, agent, harness, dataset, environment, gateway: g, attempts, summary }, signer, new Date(issued_at), { run_id, nonce });
};

console.log(`adversarial suite against ${dir}:`);
// The verifier's baseline: the committed run binds.
assert.equal(m.verifyRunManifest(manifest, { standard, receipts }, NOW).binding, 'bound', 'the committed run does not bind; nothing to test against');

caught('score raised in the manifest', (c) => { c.manifest.summary.passed += 1; }, /digest/);
caught('score raised and the manifest re-signed with the demo harness key, but the attempts still say otherwise', (c) => { c.manifest.summary.passed += 1; c.manifest = resign(c.manifest); }, /summary/);
caught('an attempt verdict flipped and the manifest re-signed', (c) => { const a = c.manifest.attempts.find((x) => x.verdict === 'pass'); a.verdict = 'fail'; c.manifest.summary.passed -= 1; c.manifest.summary.failed += 1; c.manifest = resign(c.manifest); c.manifest.attempts[0].verdict = 'pass'; }, /digest|summary/);
caught('manifest re-signed under a fresh harness key', (c) => { const other = m.runSignerFromPrivate(new Uint8Array(32).fill(7), 'Someone else'); const { type, version, run_id, standard: s, agent, harness, dataset, environment, gateway: g, attempts, summary, issued_at, nonce } = c.manifest; c.manifest = m.createRunManifest({ standard: s, agent, harness, dataset, environment, gateway: g, attempts, summary }, other, new Date(issued_at), { run_id, nonce }); }, /harness_key/);
caught('last receipt removed', (c) => { c.receipts.pop(); }, /chain_head|attempts_cover/);
caught('a receipt removed from the middle', (c) => { c.receipts.splice(1, 1); }, /chain|chain_head/);
caught('two receipts swapped', (c) => { [c.receipts[0], c.receipts[1]] = [c.receipts[1], c.receipts[0]]; }, /chain/);
caught('a receipt duplicated', (c) => { c.receipts.push(clone(c.receipts[c.receipts.length - 1])); }, /chain|chain_head/);
caught('a receipt edited (tool name changed) without re-signing', (c) => { c.receipts[0].payload.tool_name = 'WebFetch'; }, /chain/);
caught('a refusal flipped to an allow without re-signing', (c) => { const r = c.receipts.find((x) => x.payload.decision === 'deny'); if (r) r.payload.decision = 'allow'; else c.receipts[0].payload.decision = 'deny'; }, /chain|refusals/);
caught('a receipt log under a different policy digest', (c) => { for (const r of c.receipts) r.payload.policy_digest = 'sha256:' + '0'.repeat(64); }, /chain|receipt_policy/);
caught('manifest points at a different chain head', (c) => { c.manifest.gateway.chain_head = 'sha256:' + 'f'.repeat(64); c.manifest = resign(c.manifest); }, /chain_head/);
caught('task-set digest changed in the manifest and re-signed', (c) => { c.manifest.dataset.digest = 'sha256:' + 'a'.repeat(64); c.manifest = resign(c.manifest); }, /dataset_pin/);
caught('harness digest changed in the manifest and re-signed', (c) => { c.manifest.harness.digest = 'sha256:' + 'b'.repeat(64); c.manifest = resign(c.manifest); }, /harness_pin/);
caught('a second attempt added for a task, receipts re-partitioned, re-signed', (c) => { const a = clone(c.manifest.attempts[0]); a.attempt = 2; a.receipts = { from: a.receipts.to, to: a.receipts.to }; a.calls = 0; a.refused = 0; c.manifest.attempts.push(a); c.manifest.summary.passed += a.verdict === 'pass' ? 1 : 0; c.manifest.summary.failed += a.verdict === 'fail' ? 1 : 0; c.manifest = resign(c.manifest); }, /attempts|attempts_cover|summary/);
caught('an attempt stretched past the time limit and re-signed', (c) => { c.manifest.attempts[0].ended_at = new Date(Date.parse(c.manifest.attempts[0].started_at) + (standard.requirements.run.time_limit_seconds + 60) * 1000).toISOString(); c.manifest = resign(c.manifest); }, /time_limit/);
caught('the standard swapped for one with a different policy', (c) => { c.standard.enforcement.policy_digest = 'sha256:' + 'c'.repeat(64); }, /standard|policy/);
caught('the standard swapped for one that accepts a different gateway', (c) => { c.standard.trust.accepted_gate_keys = ['0'.repeat(64)]; }, /standard|gate_key/);
caught('the manifest claims a different standard digest and is re-signed', (c) => { c.manifest.standard.digest = 'd'.repeat(64); c.manifest = resign(c.manifest); }, /standard/);
caught('an allowed call to an off-list tool, forged with the demo gateway key and the chain re-linked', (c) => {
  // Forge a full chain with the public demo gateway seed: the verifier must still refuse it on the tool list.
  const forged = [];
  let prev;
  for (const r of c.receipts) {
    const payload = { ...r.payload };
    delete payload.previousReceiptHash;
    if (prev) payload.previousReceiptHash = prev;
    forged.push({ ...r, payload });
    prev = m.chainLink(forged[forged.length - 1]);
  }
  c.receipts = forged;
  c.receipts[0].payload.tool_name = 'WebFetch';
}, /chain|tools/);
caught('egress declared beyond the allowlist and re-signed', (c) => { c.manifest.environment.egress = ['evil.example']; c.manifest = resign(c.manifest); }, /egress/);
caught('a call hidden by narrowing an attempt\'s receipt range, counts adjusted, re-signed', (c) => { const a = c.manifest.attempts[c.manifest.attempts.length - 1]; a.receipts.to -= 1; a.calls -= 1; c.manifest.summary.calls -= 1; c.manifest = resign(c.manifest); }, /attempts_cover_chain/);
console.log(`\ncheck-verified-run-adversarial: ${passed} mutations caught`);
