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
// Prefer a run that carries the calls log and a second grading, so every mutation the suite knows has something to bite.
const firstRun = (base) => {
  if (!existsSync(base)) return null;
  const runs = readdirSync(base).sort().map((n) => join(base, n)).filter((d) => existsSync(join(d, 'manifest.json')));
  return runs.find((d) => existsSync(join(d, 'regrade.json')) && existsSync(join(d, 'calls.jsonl'))) ?? runs[0] ?? null;
};
const dir = resolve(process.argv[2] ?? firstRun(join(web, 'runs')) ?? resolve(web, '../samples/verified-run'));
const m = await import(pathToFileURL(join(web, 'verify/legate-run.core.mjs')).href);
const read = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const NOW = new Date('2026-09-12T00:00:00Z');

const standard = read('standard.json');
const manifest = read('manifest.json');
const receipts = m.parseReceiptLog(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')).receipts;
// The second grading and the calls log, when the run publishes them: part of the baseline every mutation is measured against.
const baseRegrade = existsSync(join(dir, 'regrade.json')) ? read('regrade.json') : null;
const baseCalls = existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const c = JSON.parse(l); return { tool: c.tool, input: c.input }; }) : null;
const clone = (v) => JSON.parse(JSON.stringify(v));
// The provenance beside the run (a run made in CI): the bundles and the exact bytes they name.
const provenanceDir = join(dir, 'provenance');
const baseBundles = existsSync(provenanceDir) ? readdirSync(provenanceDir).filter((f) => f.endsWith('.sigstore.jsonl')).sort().flatMap((f) => readFileSync(join(provenanceDir, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))) : null;
const baseBytes = baseBundles ? { manifest: readFileSync(join(dir, 'manifest.json'), 'utf8'), receipts: readFileSync(join(dir, 'receipts.jsonl'), 'utf8'), standard: readFileSync(join(dir, 'standard.json'), 'utf8'), ...(existsSync(join(dir, 'regrade.json')) ? { regrade: readFileSync(join(dir, 'regrade.json'), 'utf8') } : {}) } : null;
const baseProvenance = () => (baseBundles ? { bundles: clone(baseBundles), bytes: { ...baseBytes } } : undefined);
// The attested model route, when the run has one: the signed model calls and the attestation reports.
const baseModelCalls = existsSync(join(dir, 'model-calls.jsonl')) ? readFileSync(join(dir, 'model-calls.jsonl'), 'utf8') : null;
const baseModelAttestations = existsSync(join(dir, 'model-attestation.json')) ? JSON.parse(readFileSync(join(dir, 'model-attestation.json'), 'utf8')) : null;

let passed = 0;
/** A mutation must leave the run unbound and fail the named check (or fail to verify at all). */
function caught(name, mutate, expectCheck) {
  const ctx = { standard: clone(standard), receipts: clone(receipts), manifest: clone(manifest), regrade: baseRegrade ? clone(baseRegrade) : undefined, calls: baseCalls ? clone(baseCalls) : undefined, provenance: baseProvenance(), modelCalls: baseModelCalls ?? undefined, modelAttestations: baseModelAttestations ? clone(baseModelAttestations) : undefined };
  mutate(ctx);
  const v = m.verifyRunManifest(ctx.manifest, { standard: ctx.standard, receipts: ctx.receipts, regrade: ctx.regrade, calls: ctx.calls, provenance: ctx.provenance, modelCalls: ctx.modelCalls, modelAttestations: ctx.modelAttestations }, NOW);
  const failed = v.checks.filter((c) => !c.ok && !c.informational).map((c) => c.id);
  const okCond = v.binding !== 'bound' && (expectCheck === null || failed.some((id) => expectCheck.test(id)));
  assert.ok(okCond, `${name}: verifier accepted it (binding=${v.binding}, failed=[${failed.join(', ')}])`);
  passed++; console.log(`  ✓ caught: ${name} (${failed.slice(0, 3).join(', ') || v.binding})`);
}

const signer = m.runSignerFromSeed('legate-verified-run', 'Legate verified-run harness (demo)');
const gateway = { priv: m.GATEWAY_DEMO_SEED };
const resign = (mf) => {
  const { type, version, run_id, standard: s, agent, harness, dataset, environment, gateway: g, model_calls, attempts, summary, signer: sg, issued_at, nonce } = mf;
  return m.createRunManifest({ standard: s, agent, harness, dataset, environment, gateway: g, ...(model_calls ? { model_calls } : {}), attempts, summary }, signer, new Date(issued_at), { run_id, nonce });
};

console.log(`adversarial suite against ${dir}:`);
// The verifier's baseline: the committed run binds (with its second grading and calls when it has them; a run made before those existed may leave only the verdict-evidence check open).
const baseline = m.verifyRunManifest(manifest, { standard, receipts, regrade: baseRegrade ?? undefined, calls: baseCalls ?? undefined, provenance: baseProvenance(), modelCalls: baseModelCalls ?? undefined, modelAttestations: baseModelAttestations ? clone(baseModelAttestations) : undefined }, NOW);
const baselineOpen = baseline.checks.filter((c) => !c.ok && !c.informational).map((c) => c.id);
assert.ok(baseline.binding === 'bound' || baselineOpen.every((id) => id === 'verdict_evidence'), `the committed run does not bind; nothing to test against (${baselineOpen.join(', ')})`);

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
caught('the first receipt removed: the next one points at a predecessor that is not there', (c) => { c.receipts.shift(); }, /chain/);
if (existsSync(join(dir, 'calls.jsonl'))) {
  const callsLog = readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const callsCtx = (log) => log.map((x) => ({ tool: x.tool, input: x.input }));
  const withCalls = (mutate) => (c) => { c.calls = callsCtx(callsLog); mutate(c); };
  const caughtWith = (name, mutate, expect) => {
    const ctx = { standard: clone(standard), receipts: clone(receipts), manifest: clone(manifest), calls: callsCtx(callsLog), regrade: baseRegrade ? clone(baseRegrade) : undefined };
    mutate(ctx);
    const v = m.verifyRunManifest(ctx.manifest, { standard: ctx.standard, receipts: ctx.receipts, calls: ctx.calls, regrade: ctx.regrade }, NOW);
    const failed = v.checks.filter((x) => !x.ok && !x.informational).map((x) => x.id);
    assert.ok(v.binding !== 'bound' && failed.some((id) => expect.test(id)), `${name}: verifier accepted it (failed=[${failed.join(', ')}])`);
    passed++; console.log(`  ✓ caught: ${name} (${failed.slice(0, 3).join(', ')})`);
  };
  caughtWith('a shell command in the calls log rewritten (ls in place of what ran)', (c) => { const i = c.calls.findIndex((x) => x.tool === 'Bash'); if (i >= 0) c.calls[i] = { tool: 'Bash', input: { command: 'ls -la' } }; else c.calls[0] = { tool: c.calls[0].tool, input: {} }; }, /calls_bind/);
  caughtWith('a call dropped from the calls log', (c) => { c.calls.pop(); }, /calls_bind/);
}
if (existsSync(join(dir, 'regrade.json'))) {
  const regrade = JSON.parse(readFileSync(join(dir, 'regrade.json'), 'utf8'));
  const caughtRegrade = (name, mutate, expect) => {
    const ctx = { standard: clone(standard), receipts: clone(receipts), manifest: clone(manifest), regrade: clone(regrade), calls: baseCalls ? clone(baseCalls) : undefined };
    mutate(ctx);
    const v = m.verifyRunManifest(ctx.manifest, { standard: ctx.standard, receipts: ctx.receipts, regrade: ctx.regrade, calls: ctx.calls }, NOW);
    const failed = v.checks.filter((x) => !x.ok && !x.informational).map((x) => x.id);
    assert.ok(v.binding !== 'bound' && failed.some((id) => expect.test(id)), `${name}: verifier accepted it (failed=[${failed.join(', ')}])`);
    passed++; console.log(`  ✓ caught: ${name} (${failed.slice(0, 3).join(', ')})`);
  };
  caughtRegrade('a regrade verdict flipped without re-signing', (c) => { c.regrade.results[0].verdict = c.regrade.results[0].verdict === 'pass' ? 'fail' : 'pass'; }, /regrade/);
  if (m.isDemoRunSignerKey(manifest.signer.verification_key)) {
    caughtRegrade('a regrade signed by the harness key itself, not a second party', (c) => { const { environment, results, regraded_at, nonce } = c.regrade; c.regrade = m.createRunRegrade({ manifest: c.manifest, results, environment }, signer, new Date(regraded_at), { nonce }); }, /regrade/);
  } else {
    // Under real keys the harness key is not ours to sign with; what can be tried is a grading by a stranger the standard does not name: reported, never binding, and the run is not reconciled by it.
    const stranger = m.runSignerFromPrivate(new Uint8Array(32).fill(9), 'A stranger');
    const { environment, results, regraded_at, nonce } = baseRegrade;
    const strangerRegrade = m.createRunRegrade({ manifest, results, environment }, stranger, new Date(regraded_at), { nonce });
    const v = m.verifyRunManifest(manifest, { standard, receipts, regrade: strangerRegrade }, NOW);
    const check = v.checks.find((c) => c.id === 'regrade');
    assert.ok(check && check.informational && check.ok && /does not name/.test(check.detail), `a stranger's grading should be reported as unnamed: ${JSON.stringify(check)}`);
    assert.ok(v.binding !== 'bound' && v.checks.some((c) => c.id === 'verdict_evidence' && !c.ok), 'a stranger\'s agreeing grading must not reconcile the verdicts');
    passed++; console.log('  ✓ caught: a grading by a grader the standard does not name is reported and does not reconcile (verdict_evidence)');
  }
  caughtRegrade('a regrade for a different manifest', (c) => { c.regrade.manifest_digest = 'e'.repeat(64); }, /regrade/);
}
caught('a call hidden by narrowing an attempt\'s receipt range, counts adjusted, re-signed', (c) => { const a = c.manifest.attempts[c.manifest.attempts.length - 1]; a.receipts.to -= 1; a.calls -= 1; c.manifest.summary.calls -= 1; c.manifest = resign(c.manifest); }, /attempts_cover_chain/);

// Provenance: a run made in CI carries Sigstore bundles; each is consumed by the verifier, so each can be attacked.
if (baseBundles) {
  const flipB64 = (s, at) => { const b = Buffer.from(s, 'base64'); b[at] ^= 1; return b.toString('base64'); };
  caught('the provenance bundle\'s signature altered', (c) => { c.provenance.bundles[0].dsseEnvelope.signatures[0].sig = flipB64(c.provenance.bundles[0].dsseEnvelope.signatures[0].sig, 7); }, /provenance_1_signature/);
  caught('the provenance statement rewritten to name other bytes (payload re-encoded)', (c) => { const st = JSON.parse(Buffer.from(c.provenance.bundles[0].dsseEnvelope.payload, 'base64').toString('utf8')); st.subject[0].digest.sha256 = '0'.repeat(64); c.provenance.bundles[0].dsseEnvelope.payload = Buffer.from(JSON.stringify(st)).toString('base64'); }, /provenance_1_signature|provenance_manifest/);
  caught('the manifest re-signed to name a different workflow run', (c) => { c.manifest.environment.attestation.reference = c.manifest.environment.attestation.reference.replace(/\/runs\/\d+$/, '/runs/1'); c.manifest = resign(c.manifest); }, /provenance_1_identity/);
  caught('the log entry\'s integration time moved', (c) => { const e = c.provenance.bundles[0].verificationMaterial.tlogEntries[0]; e.integratedTime = String(Number(e.integratedTime) + 60); }, /provenance_1_log/);
  caught('an inclusion-proof hash altered', (c) => { const pr = c.provenance.bundles[0].verificationMaterial.tlogEntries[0].inclusionProof; pr.hashes[0] = flipB64(pr.hashes[0], 0); }, /provenance_1_inclusion/);
  caught('the signing certificate replaced by another workflow certificate', (c) => { const cert = Buffer.from(c.provenance.bundles[0].verificationMaterial.certificate.rawBytes, 'base64'); cert[cert.length - 24] ^= 1; c.provenance.bundles[0].verificationMaterial.certificate.rawBytes = cert.toString('base64'); }, /provenance_1_certificate|provenance_1_signature/);
  caught('the manifest file edited after attestation (a byte appended)', (c) => { c.provenance.bytes.manifest = `${c.provenance.bytes.manifest}\n`; }, /provenance_manifest/);

  // And the other way round: a bundle made in another run (a deterministic standard is attested by every run that used
  // it) verifies on its own terms, does not count, and must not unbind this run.
  const sibling = readdirSync(dirname(dir)).map((n) => join(dirname(dir), n)).filter((d) => d !== dir && existsSync(join(d, 'provenance'))).flatMap((d) => readdirSync(join(d, 'provenance')).filter((f) => f.endsWith('.sigstore.jsonl')).map((f) => readFileSync(join(d, 'provenance', f), 'utf8').split('\n').filter((l) => l.trim())[0])).map((l) => JSON.parse(l)).find((b) => !baseBundles.some((x) => JSON.stringify(x) === JSON.stringify(b)));
  if (sibling) {
    const v = m.verifyRunManifest(manifest, { standard, receipts, regrade: baseRegrade ?? undefined, calls: baseCalls ?? undefined, provenance: { bundles: [...clone(baseBundles), clone(sibling)], bytes: { ...baseBytes } } }, NOW);
    const foreignIdentity = v.checks.find((c) => /^provenance_\d+_identity$/.test(c.id) && c.informational);
    assert.ok(v.binding === baseline.binding && v.provenance?.verified === true && foreignIdentity, `a valid bundle from another run unbound this run (binding=${v.binding})`);
    passed++; console.log('  ✓ not caught, rightly: a valid bundle from another run beside this run\'s counts for nothing and unbinds nothing');
  }
}

// The attested model route: the model's TEE signed every call, and the reports bind the keys; each can be attacked.
if (baseModelCalls && baseModelAttestations) {
  const editRecord = (text, i, fn) => text.split('\n').filter(Boolean).map((l, k) => (k === i ? JSON.stringify(fn(JSON.parse(l))) : l)).join('\n') + '\n';
  caught('a model call\'s response digest rewritten (the signature no longer recovers)', (c) => { c.modelCalls = editRecord(c.modelCalls, 0, (r) => ({ ...r, response_sha256: 'a'.repeat(64) })); }, /model_calls_digest|model_calls_bind/);
  caught('a model call re-signed by an unattested key', (c) => { c.modelCalls = editRecord(c.modelCalls, 0, (r) => ({ ...r, signature: '0x' + '11'.repeat(65), signing_address: '0x' + '22'.repeat(20) })); }, /model_calls_digest|model_calls_bind/);
  caught('the attestation report\'s quote altered (one measured byte)', (c) => { const q = Buffer.from(c.modelAttestations[0].intel_quote, 'hex'); q[48 + 520 + 3] ^= 1; c.modelAttestations[0].intel_quote = q.toString('hex'); }, /model_attestation/);
  caught('the attestation report replaced by one binding another key', (c) => { c.modelAttestations[0].signing_address = '0x' + '33'.repeat(20); }, /model_attestation/);
  caught('the manifest re-signed to attest a different model', (c) => { c.manifest.environment.model_attestation.model = 'someone/else'; c.manifest = resign(c.manifest); }, /model_attestation_pin|model_calls_bind/);
  caught('a model call dropped from the log', (c) => { c.modelCalls = c.modelCalls.split('\n').filter(Boolean).slice(1).join('\n') + '\n'; }, /model_calls_digest/);
}

// Gradings made elsewhere (regrades/<grader>/), when the run has any: a flipped verdict in one of them is material.
{
  const extraDir = join(dir, 'regrades');
  const extra = existsSync(extraDir) ? readdirSync(extraDir).filter((n) => existsSync(join(extraDir, n, 'regrade.json'))).sort().map((n) => ({ regrade: JSON.parse(readFileSync(join(extraDir, n, 'regrade.json'), 'utf8')), bytes: readFileSync(join(extraDir, n, 'regrade.json'), 'utf8'), bundles: existsSync(join(extraDir, n, 'regrade.json.sigstore.jsonl')) ? readFileSync(join(extraDir, n, 'regrade.json.sigstore.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [] })) : [];
  if (extra.length) {
    const v0 = m.verifyRunManifest(manifest, { standard, receipts, regrade: baseRegrade ?? undefined, regrades: extra }, NOW);
    assert.ok(v0.checks.some((c) => c.id === 'regrade_2' && c.ok), 'the grading made elsewhere does not verify as committed; nothing to test against');
    const flipped = clone(extra); flipped[0].regrade.results[0].verdict = flipped[0].regrade.results[0].verdict === 'pass' ? 'fail' : 'pass';
    const v1 = m.verifyRunManifest(manifest, { standard, receipts, regrade: baseRegrade ?? undefined, regrades: flipped }, NOW);
    assert.ok(v1.binding !== 'bound' && v1.checks.some((c) => c.id === 'regrade_2' && !c.ok), 'a flipped verdict in a grading made elsewhere was accepted');
    passed++; console.log('  ✓ caught: a grading made elsewhere with a verdict flipped without re-signing (regrade_2)');
  }
}

// The policy digest is recomputed from the policy text: a standard whose text was edited and re-signed under the same
// (demonstration) maintainer key, keeping the declared digest, verifies as a standard and still fails the gate-policy check.
if (m.isDemoRecipientKey(standard.recipient.verification_key) && m.isDemoRunSignerKey(manifest.signer.verification_key)) {
  const maintainer = m.recipientKeyFromSeed('benchmark-maintainer', 'Benchmark maintainer', 'Terminal-Bench (demo)');
  const draft = clone(standard); for (const k of ['type', 'version', 'request_id', 'recipient', 'issued_at', 'nonce', 'digest', 'signature']) delete draft[k];
  draft.enforcement = { ...draft.enforcement, policy: `${draft.enforcement.policy}\n// edited after compilation\n` };
  const resigned = m.createProofRequest(draft, maintainer, new Date(standard.issued_at), { request_id: standard.request_id, nonce: standard.nonce });
  assert.ok(m.verifyProofRequest(resigned, NOW).cryptographically_valid, 'the re-signed standard should verify as a standard');
  // The manifest pins the standard by digest, so it is re-signed (demo harness key) to name the re-signed standard; everything else stays.
  const v = m.verifyRunManifest(resign({ ...manifest, standard: { ...manifest.standard, digest: resigned.digest } }), { standard: resigned, receipts }, NOW);
  assert.ok(v.checks.some((c) => c.id === 'standard' && c.ok), 'the re-signed manifest should name the re-signed standard');
  assert.ok(v.checks.some((c) => c.id === 'policy' && !c.ok), 'a policy text that no longer hashes to its declared digest was accepted');
  passed++; console.log('  ✓ caught: policy text edited and the standard re-signed with the declared digest kept (the digest is recomputed)');
}
console.log(`\ncheck-verified-run-adversarial: ${passed} mutations caught`);
