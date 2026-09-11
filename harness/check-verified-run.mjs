#!/usr/bin/env node
/**
 * The committed verified runs, checked on every build as a reader would check
 * them: the standard verifies and the compiler reproduces its policy; the
 * receipt chain verifies against the gateway key; the manifest verifies, binds
 * to that standard and that chain, and its pins match; the engine's recorded
 * verdicts agree with the JS mirror; the task-set digest recomputes from the
 * pinned file hashes; the test output on disk is the one the manifest digests;
 * the harness and the run core on disk are what the standard pins (a changed
 * harness means the run must be made again, not the pin moved); and the run
 * core on disk is what the source builds.
 *
 * Every samples/verified-run* directory is checked.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
// Where the runs are: a directory given on the command line (the public repository passes `runs`), else the monorepo's samples.
const samples = resolve(process.argv[2] ?? resolve(web, '../samples'));
const corePath = join(web, 'verify/legate-run.core.mjs');
const harnessPath = join(here, 'verified-run.mjs');
const m = await import(pathToFileURL(corePath).href);
const sha256Bytes = (buf) => createHash('sha256').update(buf).digest('hex');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); };

// 0. The run core on disk is what the source builds, byte for byte, so a vendored copy can be trusted by its digest.
//    (Only where the source is present; the public repository vendors the bundle and records its digest instead.)
if (existsSync(join(web, 'src/legate-run-core.ts'))) {
  const tmp = mkdtempSync(join(tmpdir(), 'legate-run-core-check-'));
  try {
    await build({ entryPoints: [join(web, 'src/legate-run-core.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: join(tmp, 'core.mjs'), legalComments: 'none', banner: { js: readFileSync(corePath, 'utf8').split('\n')[0] }, logLevel: 'silent' });
    ok('the run core bundle on disk is exactly what the source builds', readFileSync(join(tmp, 'core.mjs')).equals(readFileSync(corePath)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const sampleDirs = readdirSync(samples).map((n) => join(samples, n)).filter((d) => existsSync(join(d, 'manifest.json')) && existsSync(join(d, 'standard.json')));
assert.ok(sampleDirs.length >= 1, 'no committed verified run found');
for (const dir of sampleDirs) {
  console.log(`\n${dir.slice(samples.length + 1)}:`);
  const read = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
  const standard = read('standard.json');
  const manifest = read('manifest.json');
  const receipts = m.parseReceiptLog(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')).receipts;
  const taskSet = read('task-set.json');
  const oracle = read('oracle.json');
  const NOW = new Date('2026-09-12T00:00:00Z');

  // 1. The standard.
  const sv = m.verifyProofRequest(standard, NOW);
  ok('the run standard verifies against the maintainer key it carries', sv.cryptographically_valid);
  ok('the maintainer is the deterministic demo recipient, so the standard says demo', m.isDemoRecipientKey(standard.recipient.verification_key));
  const compiled = m.compileStandard(standard, { tool: standard.enforcement.tool, action_model: standard.enforcement.action_model });
  ok('the compiler reproduces the policy and digest the standard carries', compiled.cedar.policy === standard.enforcement.policy && compiled.cedar.digest === standard.enforcement.policy_digest);
  ok('the committed policy file is the one whose digest the standard carries', m.policyDigest('cedar', [{ name: 'standard.cedar', content: readFileSync(join(dir, 'policy/standard.cedar'), 'utf8') }]) === standard.enforcement.policy_digest);
  ok('the standard pins a task set and a harness by digest', /^sha256:[0-9a-f]{64}$/.test(standard.requirements.run.dataset.digest) && /^sha256:[0-9a-f]{64}$/.test(standard.requirements.run.harness.digest));

  // 2. The engine's recorded verdicts agree with the mirror on every counterexample.
  ok('the oracle covers every counterexample the compiler emits', oracle.length === compiled.counterexamples.length && compiled.counterexamples.every((cx) => oracle.some((o) => o.id === cx.id)));
  ok('the engine agreed with every promised verdict when the run was made', oracle.every((o) => o.engine === o.expected && o.policy_digest === standard.enforcement.policy_digest));
  ok('the JS mirror agrees with the engine on every counterexample', oracle.every((o) => (m.evaluateCompiledPolicy(compiled, { tool: o.tool, input: o.input }).allowed ? 'allow' : 'deny') === o.engine));

  // 3. The receipts.
  const chain = m.verifyActaChain(receipts, { publicKeyHex: manifest.gateway.verification_key });
  ok('every receipt verifies against the gateway key and the chain is unbroken', chain.all_signatures_valid && chain.chain_unbroken && chain.signatures_checked && chain.count === receipts.length);
  ok('every receipt cites the policy compiled from the standard', chain.receipts.every((r) => r.policy_digest === standard.enforcement.policy_digest));
  ok('every allowed call names a tool on the standard\'s list', chain.receipts.filter((r) => r.decision === 'allow').every((r) => standard.requirements.run.allowed_tools.includes(r.tool)));
  ok('the receipts carry input digests (protect-mcp with payload_digest)', chain.receipts.every((r) => typeof r.input_hash === 'string'));

  // 4. The manifest, alone and bound.
  const alone = m.verifyRunManifest(manifest, {}, NOW);
  ok('the manifest verifies on its own and says it is unbound', alone.cryptographically_valid && alone.binding === 'manifest_only');
  ok('the harness signer is the deterministic demo key, so the manifest says demo', m.isDemoRunSignerKey(manifest.signer.verification_key));
  const bound = m.verifyRunManifest(manifest, { standard, receipts }, NOW);
  ok('with the standard and the receipts the manifest is bound', bound.binding === 'bound' && bound.checks.every((c) => c.ok || c.informational));
  ok('the manifest names the chain head and count that the receipt log has', manifest.gateway.receipt_count === receipts.length && manifest.gateway.chain_head === m.chainLink(receipts[receipts.length - 1]));
  ok('the manifest\'s log digest is the digest of the committed JSONL bytes', manifest.gateway.log_digest === m.fileDigest(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')));
  ok('at least one task passed and every attempt has receipts', manifest.summary.passed >= 1 && manifest.attempts.every((a) => a.calls >= 1));

  // 5. Tampering is caught.
  const moved = structuredClone(manifest); moved.summary.passed += 1;
  ok('a manifest with its score raised fails its digest', !m.verifyRunManifest(moved, {}, NOW).digest_valid);
  const shortened = receipts.slice(0, -1);
  ok('a receipt log with the last receipt removed no longer matches the manifest\'s chain head', shortened.length === 0 || m.verifyRunManifest(manifest, { standard, receipts: shortened }, NOW).checks.some((c) => c.id === 'chain_head' && !c.ok));
  const otherStandard = structuredClone(standard); otherStandard.requirements.run.attempts_per_task = 0; // a different (unsigned-invalid) standard
  ok('a manifest checked against a standard it was not made under does not bind', m.verifyRunManifest(manifest, { standard: otherStandard, receipts }, NOW).binding !== 'bound');

  // 6. The pins recompute.
  ok('the task-set digest recomputes from the pinned paths and hashes', m.taskSetDigest(taskSet.name, taskSet.revision, taskSet.tasks) === taskSet.digest && taskSet.digest === standard.requirements.run.dataset.digest);
  ok('the task set carries hashes, not benchmark files', taskSet.tasks.every((t) => t.files.every((f) => typeof f.sha256 === 'string' && !('content' in f))));
  // The exact harness bytes a run pins must be in the repository: the current files, or an archived earlier
  // version under harness-versions/<first 16 hex of the pin>/ (both files), so a reader can always open what ran.
  const pin = standard.requirements.run.harness.digest;
  const digestOf = (h, c) => `sha256:${m.sha256Hex(m.canonicalize({ name: 'legate-verified-run', files: [{ name: 'verified-run.mjs', sha256: sha256Bytes(h) }, { name: 'legate-run.core.mjs', sha256: sha256Bytes(c) }] }))}`;
  const archived = join(dirname(harnessPath), 'harness-versions', pin.slice('sha256:'.length, 'sha256:'.length + 16));
  const harnessBytes = digestOf(readFileSync(harnessPath), readFileSync(corePath)) === pin ? { h: readFileSync(harnessPath), c: readFileSync(corePath), where: 'current' }
    : existsSync(join(archived, 'verified-run.mjs')) && existsSync(join(archived, 'legate-run.core.mjs')) ? { h: readFileSync(join(archived, 'verified-run.mjs')), c: readFileSync(join(archived, 'legate-run.core.mjs')), where: archived } : null;
  ok(`the harness and run core the standard pins are in the repository (${harnessBytes?.where === 'current' ? 'the current files' : harnessBytes ? 'archived under harness-versions' : 'MISSING: archive the harness that made this run, or make the run again'})`, harnessBytes !== null && digestOf(harnessBytes.h, harnessBytes.c) === pin);
  const harnessFiles = [{ name: 'verified-run.mjs', sha256: sha256Bytes(harnessBytes.h) }, { name: 'legate-run.core.mjs', sha256: sha256Bytes(harnessBytes.c) }];
  const harnessNow = pin;
  const harnessJson = read('harness.json');
  ok('harness.json records the same pin and the same two files', harnessJson.digest === harnessNow && harnessJson.files.every((f) => harnessFiles.some((g) => g.name === f.name && g.sha256 === f.sha256)));
  ok('the harness key that signed the manifest is one the standard accepts as a readback source', standard.trust.accepted_readback_sources.includes(manifest.signer.verification_key));
  for (const a of manifest.attempts) {
    ok(`the committed test output for ${a.task_id} is the one the manifest digests`, m.fileDigest(readFileSync(join(dir, 'tests', `${a.task_id}.txt`), 'utf8')) === a.tests.output_digest);
  }

  // 7. When the run was made in CI, the provenance bundles beside it name these exact bytes and that workflow.
  //    (Consistency only: the Sigstore signature itself is checked with `gh attestation verify`.)
  const provenanceDir = join(dir, 'provenance');
  if (existsSync(provenanceDir)) {
    for (const f of ['manifest.json', 'receipts.jsonl', 'standard.json']) {
      const bundle = JSON.parse(readFileSync(join(provenanceDir, `${f}.sigstore.jsonl`), 'utf8').trim().split('\n')[0]);
      const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
      const digest = m.fileDigest(readFileSync(join(dir, f), 'utf8')).slice('sha256:'.length);
      ok(`the provenance bundle for ${f} names the committed bytes`, statement.subject.some((s) => s.digest?.sha256 === digest) && statement.predicateType === 'https://slsa.dev/provenance/v1');
      if (f === 'manifest.json') {
        const att = manifest.environment.attestation;
        ok('the manifest names the workflow run the provenance was made in', att && att.kind === 'github-actions-provenance' && String(statement.predicate?.runDetails?.metadata?.invocationId ?? '').startsWith(att.reference));
        ok('the provenance names the verified-run workflow file', /verified-run\.yml/.test(String(statement.predicate?.buildDefinition?.externalParameters?.workflow?.path ?? '')));
      }
    }
  } else {
    ok('a run made outside CI carries no attestation and says so', manifest.environment.attestation === null);
  }

  // 8. The readbacks say what they should.
  const readback = m.runManifestReadback(manifest);
  ok('the manifest readback names the task set, the agent, the pins, and the result', /Task set: terminal-bench/.test(readback) && /Agent: /.test(readback) && /Harness: legate-verified-run/.test(readback) && /Result: \d+ of \d+ passed/.test(readback));
  ok('the standard readback names the run rules and the pins', /Run: tools /.test(m.proofRequestReadback(standard)) && /Run pins: task set terminal-bench/.test(m.proofRequestReadback(standard)));
}
console.log(`\ncheck-verified-run: ${passed} checks passed over ${sampleDirs.length} run${sampleDirs.length === 1 ? '' : 's'}`);
