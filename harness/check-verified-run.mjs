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
import { spawnSync } from 'node:child_process';
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
const require_sha = (f) => createHash('sha256').update(Buffer.from(f.content, 'base64')).digest('hex') === f.sha256;

// 0. The run core on disk is what the source builds, byte for byte, so a vendored copy can be trusted by its digest.
//    (Only where the source is present; the public repository vendors the bundle and records its digest instead.)
if (existsSync(join(web, 'src/legate-run-core.ts'))) {
  const tmp = mkdtempSync(join(tmpdir(), 'legate-run-core-check-'));
  try {
    await build({ entryPoints: [join(web, 'src/legate-run-core.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: join(tmp, 'core.mjs'), legalComments: 'none', banner: { js: readFileSync(corePath, 'utf8').split('\n')[0] }, logLevel: 'silent' });
    ok('the run core bundle on disk is exactly what the source builds', readFileSync(join(tmp, 'core.mjs')).equals(readFileSync(corePath)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// 0b. The attestation primitives against known material: a real TDX quote verifies to the pinned Intel root, and the
//     provider-documented model-call signature recovers to its address. If either breaks, every attested run would.
{
  const sample = readFileSync(join(here, 'fixtures', 'tdx-quote-sample.hex'), 'utf8').trim();
  ok('a real Intel TDX quote verifies offline to the pinned Intel SGX Root CA', m.verifyTdxQuote(sample, new Date('2026-09-12T00:00:00Z')).valid);
  const flipped = Buffer.from(sample.replace(/^0x/, ''), 'hex'); flipped[48 + 520 + 3] ^= 1;
  ok('the sample quote parses to its measurements', m.parseTdxQuote(sample).measurements.mr_td.length === 96);
  ok('a TDX quote with one measured byte changed fails on its signature', m.verifyTdxQuote(new Uint8Array(flipped), new Date('2026-09-12T00:00:00Z')).checks.some((c) => c.id === 'quote_signature' && !c.ok));
  ok('a documented model-call signature recovers to its signing address', m.recoverSigner({ index: 0, model: 'Qwen/Qwen3.5-122B-A10B', kind: 'provider_tee', request_sha256: '2974f24b2a687856d2a0cf08d813902965c25e6552ba7062e4fa303432b6d2ad', response_sha256: '8cb30eef9d133bdc6bfe812772dc4a62336d2827caea843546cbeff3f004c42c', signature: '0xed381e84d059198d1826e44dbbbac9501caaa8f79f913f27578acafa5be852e6103fe34fabd6446d7fde3f5250c0a16e109fe088a562bae08ac13d081a66d0761b', signing_address: '0x6525e128afcffebf7eed05d485d7be983cdae934', signing_algo: 'ecdsa' }) === '0x6525e128afcffebf7eed05d485d7be983cdae934');
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
  // The calls log, the archived workspaces, and the second grading, when the run publishes them.
  const callsPath = join(dir, 'calls.jsonl');
  const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null;
  if (calls) {
    ok('the calls log is the one the manifest digests, byte for byte', manifest.gateway.calls_digest === m.fileDigest(readFileSync(callsPath, 'utf8')) && manifest.gateway.calls_disclosed === true);
    ok('every receipt opens to the call the log records (tool and input digest)', m.verifyRunManifest(manifest, { standard, receipts, calls: calls.map((c) => ({ tool: c.tool, input: c.input })) }, NOW).checks.find((c) => c.id === 'calls_bind')?.ok === true);
  } else if (manifest.gateway.calls_digest) {
    ok('the calls log is held, and the manifest says so', manifest.gateway.calls_disclosed === false);
  }
  // The attested model route, when the run has one: every model call signed inside the model's TEE, every report verified to Intel's root.
  const modelCallsPath = join(dir, 'model-calls.jsonl');
  if (manifest.environment.model_attestation || existsSync(modelCallsPath)) {
    ok('a run with an attested model route carries its signed model calls and its attestation reports', !!manifest.environment.model_attestation && !!manifest.model_calls && existsSync(modelCallsPath) && existsSync(join(dir, 'model-attestation.json')));
    const modelCalls = readFileSync(modelCallsPath, 'utf8');
    const modelAttestations = JSON.parse(readFileSync(join(dir, 'model-attestation.json'), 'utf8'));
    const av = m.verifyRunManifest(manifest, { standard, receipts, calls, regrade, modelCalls, modelAttestations }, NOW);
    const failed = av.checks.filter((c) => (c.id.startsWith('model_') || c.id === 'model_route') && !c.ok).map((c) => `${c.id}: ${c.detail}`);
    ok(`every model call (${manifest.model_calls?.count ?? 0}) was signed inside the model's TEE and every attestation report (${modelAttestations.length}) verifies offline to Intel's root${failed.length ? `: ${failed.join('; ')}` : ''}`, failed.length === 0 && av.checks.some((c) => c.id === 'model_calls_bind' && c.ok && !c.informational));
    ok('the standard names the attested provider and model the manifest carries', standard.requirements.run?.model_attestation?.model === manifest.environment.model_attestation?.model && av.checks.some((c) => c.id === 'model_attestation_pin' && c.ok));
    if (manifest.model_calls?.disclosed) ok('the model-call bodies are published and each hashes to its record', (() => { const bodies = readFileSync(join(dir, 'model-calls-bodies.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); const records = modelCalls.split('\n').filter(Boolean).map((l) => JSON.parse(l)); return bodies.length === records.length && bodies.every((b, i) => sha256Bytes(Buffer.from(b.request, 'utf8')) === records[i].request_sha256 && sha256Bytes(Buffer.from(b.response, 'utf8')) === records[i].response_sha256); })());
  }
  const workspaces = {};
  for (const a of manifest.attempts) {
    const wp = join(dir, 'workspace', `${a.task_id}.json`);
    if (!a.workspace || !existsSync(wp)) continue;
    const archive = JSON.parse(readFileSync(wp, 'utf8'));
    ok(`the workspace archive for ${a.task_id} is the one the manifest pins (${a.workspace.file_count} file${a.workspace.file_count === 1 ? '' : 's'})`, m.workspaceDigest(archive.files) === a.workspace.digest && archive.files.length === a.workspace.file_count);
    if (a.workspace.disclosed) ok(`every archived file for ${a.task_id} matches its own digest`, archive.files.every((f) => typeof f.content === 'string' && require_sha(f)));
    workspaces[a.task_id] = archive.files;
  }
  const regradePath = join(dir, 'regrade.json');
  const regrade = existsSync(regradePath) ? JSON.parse(readFileSync(regradePath, 'utf8')) : null;
  if (regrade) ok('the second grading verifies, is by a distinct key the standard accepts, and agrees with every verdict', m.verifyRunManifest(manifest, { standard, receipts, regrade }, NOW).checks.find((c) => c.id === 'regrade')?.ok === true);
  const bound = m.verifyRunManifest(manifest, { standard, receipts, calls: calls ? calls.map((c) => ({ tool: c.tool, input: c.input })) : undefined, workspaces: Object.keys(workspaces).length ? workspaces : undefined, regrade }, NOW);
  const openChecks = bound.checks.filter((c) => !c.ok && !c.informational).map((c) => c.id);
  ok(`with the standard, the receipts${calls ? ', the calls' : ''}${Object.keys(workspaces).length ? ', the workspaces' : ''}${regrade ? ', and the regrade' : ''} the manifest is bound${regrade ? '' : ' except for the verdict evidence the standard asks a second grading for'}`, regrade ? bound.binding === 'bound' : openChecks.every((id) => id === 'verdict_evidence'));
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

  // 7. When the run was made in CI, the Sigstore bundles beside it are verified here, offline, against the pinned
  //    trust root (certificate chain, workflow identity, signature, log entry, inclusion, SCT), and must name these
  //    exact bytes and the run the manifest names. `gh attestation verify` is an independent path, not the only one.
  const provenanceDir = join(dir, 'provenance');
  if (existsSync(provenanceDir)) {
    const bundles = readdirSync(provenanceDir).filter((f) => f.endsWith('.sigstore.jsonl')).sort().flatMap((f) => readFileSync(join(provenanceDir, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
    const bytes = { manifest: readFileSync(join(dir, 'manifest.json')), receipts: readFileSync(join(dir, 'receipts.jsonl')), standard: readFileSync(join(dir, 'standard.json')), ...(existsSync(regradePath) ? { regrade: readFileSync(regradePath) } : {}) };
    const pv = m.verifyRunManifest(manifest, { standard, receipts, calls, regrade, provenance: { bundles, bytes } }, NOW);
    const provChecks = pv.checks.filter((c) => c.id.startsWith('provenance_'));
    const failedProv = provChecks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
    ok(`the provenance bundles verify offline against the pinned Sigstore trust root (${provChecks.length} checks)${failedProv.length ? `: ${failedProv.join('; ')}` : ''}`, failedProv.length === 0 && pv.provenance?.verified === true);
    ok('the provenance names the committed bytes of the manifest, the receipt chain, the standard, and the second grading', ['manifest', 'receipts', 'standard', ...(existsSync(regradePath) ? ['regrade'] : [])].every((r) => pv.provenance.covered.includes(r)));
    const att = manifest.environment.attestation;
    ok('the certificate names the workflow run the manifest names, and the verified-run workflow file', att?.kind === 'github-actions-provenance' && String(pv.provenance.identity?.run ?? '').startsWith(`${att.reference}/`) && /\/\.github\/workflows\/verified-run\.yml@/.test(String(pv.provenance.identity?.workflow ?? '')));
    // The harness the manifest pins is the harness the repository held at the attested commit, where that commit is in reach (the public repository).
    const commit = pv.provenance.identity?.commit ?? null;
    const inHistory = commit !== null && spawnSync('git', ['-C', web, 'cat-file', '-e', `${commit}^{commit}`]).status === 0;
    if (inHistory) {
      const show = (p) => spawnSync('git', ['-C', web, 'show', `${commit}:${p}`]);
      const h = show('harness/verified-run.mjs'), c = show('verify/legate-run.core.mjs');
      if (h.status === 0 && c.status === 0) {
        const pin = `sha256:${m.sha256Hex(m.canonicalize({ name: 'legate-verified-run', files: [{ name: 'verified-run.mjs', sha256: sha256Bytes(h.stdout) }, { name: 'legate-run.core.mjs', sha256: sha256Bytes(c.stdout) }] }))}`;
        ok(`the harness the manifest pins is the harness the repository held at the attested commit ${commit.slice(0, 12)}`, pin === manifest.harness.digest);
      } else console.log(`  · the attested commit ${commit.slice(0, 12)} holds no harness pair to compare`);
    } else console.log(`  · the attested commit ${commit ? commit.slice(0, 12) : '(none)'} is not in this repository's history; the harness-at-commit check runs in the repository that made the run`);
  } else {
    ok('a run made outside CI carries no attestation and says so', manifest.environment.attestation === null);
  }

  // 8. The readbacks say what they should.
  const readback = m.runManifestReadback(manifest);
  ok('the manifest readback names the task set, the agent, the pins, and the result', /Task set: terminal-bench/.test(readback) && /Agent: /.test(readback) && /Harness: legate-verified-run/.test(readback) && /Result: \d+ of \d+ passed/.test(readback));
  ok('the standard readback names the run rules and the pins', /Run: tools /.test(m.proofRequestReadback(standard)) && /Run pins: task set terminal-bench/.test(m.proofRequestReadback(standard)));
}
console.log(`\ncheck-verified-run: ${passed} checks passed over ${sampleDirs.length} run${sampleDirs.length === 1 ? '' : 's'}`);
