#!/usr/bin/env node
/**
 * Check a swarm run as a stranger would: every signature, every chain, every
 * pin, the receivers' journals replayed, the conservation invariant, the
 * history rules replayed over every member's chain, and the outcomes
 * recomputed from the journals and compared with what the harness wrote.
 *
 *   node harness/check-swarm.mjs swarm            (every run under the directory)
 *   node harness/check-swarm.mjs swarm/B-1234     (one run)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordsOf, worldTaskManifest } from './swarm/world.mjs';
import { computeOutcomes } from './swarm/outcomes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const corePath = join(here, '../verify/legate-run.core.mjs');
const m = await import(pathToFileURL(corePath).href);
const sha256Bytes = (buf) => createHash('sha256').update(buf).digest('hex');
const target = resolve(process.argv[2] ?? 'swarm');
const dirs = existsSync(join(target, 'swarm.json')) ? [target] : existsSync(target) ? readdirSync(target).map((n) => join(target, n)).filter((d) => existsSync(join(d, 'swarm.json'))).sort() : [];
if (!dirs.length) { console.error(`no swarm run under ${target}`); process.exit(1); }
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); };
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const lines = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));

for (const dir of dirs) {
  console.log(`\n${dir}`);
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const swarmText = read('swarm.json'); const swarm = JSON.parse(swarmText);
  const { digest, signature, ...body } = swarm;
  const standard = JSON.parse(read('standard.json'));
  const world = JSON.parse(read('world.json'));
  const outcomesText = read('outcomes.json'); const outcomes = JSON.parse(outcomesText);

  // 1. The swarm manifest, the standard, the keys.
  ok('the swarm manifest verifies under the harness key it names', m.verifyCanonical('legate.swarm_run.v1', body, digest, signature, swarm.signer.verification_key));
  ok('the harness key is one the standard accepts as a readback source', standard.trust.accepted_readback_sources.includes(swarm.signer.verification_key));
  const sv = m.verifyProofRequest(standard);
  ok('the standard verifies under the maintainer key beside it', sv.cryptographically_valid && JSON.parse(read('maintainer-key.json')).public_key === standard.recipient.verification_key);
  ok('the swarm manifest names this standard by digest', swarm.standard.digest === standard.digest && swarm.standard.request_id === standard.request_id);

  // 2. The pins: the harness bytes and the world.
  const pin = swarm.harness.digest;
  const archived = join(here, 'harness-versions', pin.slice('sha256:'.length, 'sha256:'.length + 16));
  const fileBytes = (name) => (existsSync(join(archived, name)) ? readFileSync(join(archived, name)) : existsSync(join(here, name)) ? readFileSync(join(here, name)) : name === 'legate-run.core.mjs' ? readFileSync(corePath) : null);
  const files = swarm.harness.files.map((f) => ({ name: f.name, sha256: (() => { const b = existsSync(join(archived, f.name)) ? readFileSync(join(archived, f.name)) : f.name === 'legate-run.core.mjs' ? readFileSync(corePath) : readFileSync(join(here, f.name)); return sha256Bytes(b); })() }));
  const recomputedPin = `sha256:${m.sha256Hex(m.canonicalize({ name: 'legate-swarm-run', files }))}`;
  ok(`the harness the standard pins is in the repository (${existsSync(archived) ? 'archived under harness-versions' : 'the current files'})`, recomputedPin === pin && standard.requirements.run.harness.digest === pin && files.every((f) => swarm.harness.files.some((g) => g.name === f.name && g.sha256 === f.sha256)));
  void fileBytes;
  const taskManifest = worldTaskManifest(world, {});
  const datasetDigest = m.taskSetDigest(swarm.world.name, swarm.world.seed, [taskManifest]);
  ok('the world recomputes to the dataset digest the standard pins', datasetDigest === standard.requirements.run.dataset.digest && datasetDigest === swarm.world.digest);
  ok('world.json is the file the swarm manifest digests', m.fileDigest(read('world.json')) === swarm.world.world_digest);
  void recordsOf;

  // 3. Logs by digest.
  const effects = lines(read('effects.jsonl')); const refusals = lines(read('refusals.jsonl')); const harnessRefusals = lines(read('history-rule-refusals.jsonl'));
  ok('the effects, refusals, history-rule refusals, and instructions are the files the swarm manifest digests', m.fileDigest(read('effects.jsonl')) === swarm.logs.effects && m.fileDigest(read('refusals.jsonl')) === swarm.logs.refusals && m.fileDigest(read('history-rule-refusals.jsonl')) === swarm.logs.history_rule_refusals && m.fileDigest(read('instructions.json')) === swarm.logs.instructions);
  ok('outcomes.json is the file the swarm manifest digests', m.fileDigest(outcomesText) === swarm.outcomes_digest);

  // 4. Every member's manifest, as the published verifier reads it, and its place in the swarm manifest.
  const members = Object.keys(swarm.members);
  const gateRefusals = [];
  for (const id of members) {
    const d = join(dir, 'agents', id);
    const manifest = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    const receipts = lines(readFileSync(join(d, 'receipts.jsonl'), 'utf8'));
    const calls = lines(readFileSync(join(d, 'calls.jsonl'), 'utf8'));
    const attested = existsSync(join(d, 'model-calls.jsonl'));
    const v = m.verifyRunManifest(manifest, { standard, receipts, calls: calls.map((c) => ({ tool: c.tool, input: c.input })), bytes: { receipts: readFileSync(join(d, 'receipts.jsonl')), calls: readFileSync(join(d, 'calls.jsonl')) }, ...(attested ? { modelCalls: readFileSync(join(d, 'model-calls.jsonl'), 'utf8'), modelAttestations: JSON.parse(readFileSync(join(d, 'model-attestation.json'), 'utf8')) } : {}) });
    const open = v.checks.filter((c) => !c.ok && !c.informational && c.id !== 'verdict_evidence');
    ok(`${id} (${swarm.members[id].role}): the manifest binds to the standard and its ${receipts.length} receipts${attested ? ', model calls attested' : ''} (${v.checks.length} checks; the second grading is not this run's evidence path)`, open.length === 0 && manifest.digest === swarm.members[id].manifest_digest && manifest.gateway.chain_head === swarm.members[id].chain_head);
    ok(`${id}: the outcome record is the one the manifest digests`, m.fileDigest(readFileSync(join(d, 'outcome.json'), 'utf8')) === manifest.attempts[0].tests.output_digest);
    for (const r of receipts) if ((r.payload?.decision ?? r.decision) === 'deny') gateRefusals.push({ agent: id, tool: r.payload?.tool ?? r.tool });
    if (standard.requirements.run.temporal) {
      const chain = m.verifyActaChain(receipts, { publicKeyHex: manifest.gateway.verification_key });
      const events = m.projectEvents(chain.receipts.map((r) => ({ tool: r.tool ?? '', decision: r.decision === 'deny' ? 'deny' : 'allow', input_hash: r.input_hash ?? '', issued_at: r.issued_at ?? new Date(0).toISOString(), link: r.hash })), { calls: calls.map((c) => ({ tool: c.tool, input: c.input })) });
      const ev = m.evaluateTemporal(events, { format: m.TEMPORAL_POLICY_V1, rules: standard.requirements.run.temporal });
      ok(`${id}: the ${standard.requirements.run.temporal.length} history rules hold at every one of ${events.length} receipts (refusals before the gate: ${harnessRefusals.filter((h) => h.agent === id).length})`, ev.ok);
    }
  }

  // 5. Grants, allocations, receivers, conservation (B and C).
  if (swarm.controls.authority) {
    const grants = Object.fromEntries(Object.keys(swarm.grants).map((n) => [n, JSON.parse(read(`grants/${n}.json`))]));
    ok('every grant verifies under the principal key and is the one the swarm manifest names', Object.entries(grants).every(([n, g]) => m.verifyAuthorityGrant(g).cryptographically_valid && g.principal.verification_key === swarm.principal.verification_key && g.digest === swarm.grants[n].digest));
    const allocations = {};
    for (const id of members) { allocations[id] = {}; for (const n of Object.keys(grants)) allocations[id][n] = JSON.parse(read(`allocations/${id}.${n}.json`)); }
    ok('every allocation chains to its grant, is made out to the member and the receiver it names, and is the one the swarm manifest names', members.every((id) => Object.entries(allocations[id]).every(([n, a]) => m.verifyAllocationChain(grants[n], [a]).valid && a.holder.verification_key === swarm.members[id].holder.verification_key && a.receiver.verification_key === swarm.receivers[n].verification_key && a.digest === swarm.allocations[id][n].digest)));
    ok('per grant, the allocations sum to at most the grant', Object.keys(grants).every((n) => members.reduce((s, id) => s + allocations[id][n].amount, 0) <= grants[n].scope.budget.amount));
    const keys = JSON.parse(read('receivers/keys.json'));
    const restored = {};
    for (const n of Object.keys(grants)) {
      const entries = lines(read(`receivers/${n}.journal.jsonl`));
      const store = new m.MemoryJournal(); for (const e of entries) store.append(e);
      const r = m.ReceiverRuntime.restore({ key_id: keys[n].key_id, verification_key: keys[n].verification_key, priv: new Uint8Array(32), name: `${n} service` }, store);
      restored[n] = r;
      ok(`the ${n} receiver restores from its journal to the head the swarm manifest records (${entries.length} entries)`, r.journalHead === swarm.receivers[n].journal_head && entries.length === swarm.receivers[n].entries);
    }
    const decisions = lines(read('receivers/decisions.jsonl'));
    const heads = new Set(Object.keys(grants).flatMap((n) => lines(read(`receivers/${n}.journal.jsonl`)).map((e) => e.head)));
    ok(`every one of ${decisions.length} receiver decisions verifies under its receiver's key and cites a journal head that exists`, decisions.every((d) => m.verifyReceiverDecision(d, { receiver_key: keys[Object.keys(keys).find((n) => keys[n].key_id === d.receiver.key_id)]?.verification_key ?? '' }).cryptographically_valid && heads.has(d.journal_head)));
    const conservation = Object.fromEntries(Object.keys(grants).map((n) => [n, m.checkConservation(grants[n], members.map((id) => allocations[id][n]), [restored[n]])]));
    ok(`the conservation invariant holds on every grant and matches the harness's account (${Object.entries(conservation).map(([n, c]) => `${n}: ${c.consumed} consumed of ${c.grant}`).join('; ')})`, Object.values(conservation).every((c) => c.ok) && Object.keys(grants).every((n) => conservation[n].detail === swarm.conservation[n].detail));
    for (const n of Object.keys(grants)) if (keys[n].quota) { const rp = m.replayQuota(lines(read(`receivers/${n}.journal.jsonl`)), keys[n].quota); ok(`the ${n} receiver's quota replays from its journal (${rp.filter((x) => !x.admitted).length} refusals)`, rp.every((x) => x.admitted === (lines(read(`receivers/${n}.journal.jsonl`)).find((e) => e.seq === x.seq)?.kind === 'reserved'))); }
  }

  // 6. The outcomes recompute from the journals.
  const roles = Object.fromEntries(members.map((id) => [id, swarm.members[id].role]));
  const recomputed = computeOutcomes(world, { effects, refusals, harnessRefusals, gateRefusals, agents: roles, costs: outcomes.cost.per_agent });
  const same = (k) => JSON.stringify(recomputed[k]) === JSON.stringify(outcomes[k]);
  ok(`the outcomes recompute from the journals: ${recomputed.unauthorized_effects.count} unauthorized effects, ${recomputed.legitimate_completion.paid_correctly} of ${recomputed.legitimate_completion.of} paid correctly, ${recomputed.legitimate_completion.declined_correctly} of ${recomputed.legitimate_completion.to_decline} declined correctly, ${recomputed.false_blocks.count} false blocks`, ['unauthorized_effects', 'legitimate_completion', 'false_blocks', 'planted_notes', 'agents'].every(same));
  if (outcomes.attacker) ok(`the scripted attacker's ${outcomes.attacker.steps.length} steps and ${outcomes.attacker.probes.length} probes ${outcomes.attacker.all_matched ? 'all went as expected' : 'DID NOT all go as expected'}`, outcomes.attacker.all_matched);
  // Token cost recomputes from the published bodies, where the route was attested.
  let tokIn = 0, tokOut = 0, calls = 0, any = false;
  for (const id of members) { const f = join(dir, 'agents', id, 'model-calls-bodies.jsonl'); if (!existsSync(f)) continue; any = true; for (const b of lines(readFileSync(f, 'utf8'))) { try { const u = JSON.parse(b.response).usage ?? {}; tokIn += u.prompt_tokens ?? 0; tokOut += u.completion_tokens ?? 0; calls++; } catch { /* no usage */ } } }
  if (any) ok(`the token cost recomputes from the published model-call bodies (${tokIn} in, ${tokOut} out, ${calls} calls)`, tokIn === outcomes.cost.input_tokens && tokOut === outcomes.cost.output_tokens && calls === outcomes.cost.model_calls);
}
console.log(`\ncheck-swarm: ${passed} checks passed over ${dirs.length} run${dirs.length === 1 ? '' : 's'}`);
