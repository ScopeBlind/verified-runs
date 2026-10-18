#!/usr/bin/env node
/**
 * check-swarm against a receiver that lies. A scripted swarm run (configuration
 * B, one member and the attacker, no model, demonstration keys) is made in a
 * temporary directory, then altered the ways a dishonest receiver or harness
 * would alter it, with every signature remade under the demonstration keys so
 * that no alteration fails on a signature alone. check-swarm must refuse every
 * altered copy, and must pass a copy whose swarm manifest is re-signed with
 * nothing changed, so each refusal belongs to the alteration and not to the
 * re-signing.
 *
 *   node harness/check-swarm-adversarial.mjs
 *   node harness/check-swarm-adversarial.mjs --run <swarm run dir> --checker <path to a check-swarm.mjs>
 *
 * With --run and --checker it alters a run already made (by any version of the harness, with demonstration keys)
 * and checks the copies with the given checker, which is how a checker from before 18 October 2026 is shown to miss
 * these alterations.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(join(here, '../verify/legate-run.core.mjs')).href);
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const checker = resolve(flag('--checker', join(here, 'check-swarm.mjs')));
const given = flag('--run', null);
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const lines = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// The demonstration keys a locally made run uses, derived as swarm-run.mjs derives them.
const signer = m.runSignerFromSeed('legate-verified-run', 'Legate verified-run harness (demo)');
const demoKey = (label, prefix) => m.holderFromPrivate(Buffer.from(sha(`legate-swarm-demo:${label}`), 'hex'), prefix);
const receiverKey = (n) => ({ ...demoKey(`receiver:${n}`, 'receiver'), name: `${n} service` });

const tmp = mkdtempSync(join(tmpdir(), 'check-swarm-adversarial-'));
let failures = 0; let passed = 0;
try {
  let base = given ? resolve(given) : join(tmp, 'run');
  if (!given) {
    const env = { ...process.env }; for (const k of ['LEGATE_MAINTAINER_SEED', 'LEGATE_ATTEST', 'NEARAI_CLOUD_API_KEY', 'GITHUB_ACTIONS']) delete env[k];
    const made = spawnSync(process.execPath, [join(here, 'swarm-run.mjs'), '--config', 'B', '--agent', 'scripted', '--agents', '1', '--out', base], { encoding: 'utf8', env, timeout: 300_000 });
    if (made.status !== 0) { console.error(`the scripted run failed:\n${(made.stderr || made.stdout).slice(-2000)}`); process.exit(1); }
  }
  const swarm0 = JSON.parse(readFileSync(join(base, 'swarm.json'), 'utf8'));
  if (swarm0.signer.verification_key !== signer.verification_key || swarm0.receivers?.ledger?.verification_key !== receiverKey('ledger').verification_key) { console.error('the run was not made with the demonstration keys, so it cannot be re-signed here'); process.exit(1); }
  console.log(`A scripted run (configuration ${swarm0.config}, ${Object.keys(swarm0.members).length} members), altered, each copy checked by ${checker.replace(`${resolve(here, '..')}/`, '')}:`);

  // Helpers over a copy of the run.
  const copy = (name) => { const d = join(tmp, name); cpSync(base, d, { recursive: true }); return d; };
  const io = (d) => ({
    read: (f) => readFileSync(join(d, f), 'utf8'),
    write: (f, t) => writeFileSync(join(d, f), t),
    swarm: () => JSON.parse(readFileSync(join(d, 'swarm.json'), 'utf8')),
  });
  const resign = (d, edit = () => {}) => {
    const f = io(d); const { digest, signature, ...body } = f.swarm(); void digest; void signature;
    body.logs.decisions = m.fileDigest(f.read('receivers/decisions.jsonl'));
    for (const n of Object.keys(body.receivers ?? {})) { const es = lines(f.read(`receivers/${n}.journal.jsonl`)); body.receivers[n].journal_head = es.length ? es[es.length - 1].head : '0'.repeat(64); body.receivers[n].entries = es.length; }
    edit(body);
    const sig = m.signCanonical('legate.swarm_run.v1', body, signer.priv);
    f.write('swarm.json', json({ ...body, digest: sig.digest, signature: sig.signature }));
  };
  const resignDecision = (d, change) => m.createReceiverDecision({ spend: d.spend, allocation_id: d.allocation_id, outcome: d.outcome, reason_code: d.reason_code, reason: d.reason, evidence: d.evidence, next_actions: d.next_actions, not_permitted: d.not_permitted, effect: d.effect, journal_head: d.journal_head, ...change, receiver: receiverKey(Object.keys(swarm0.receivers).find((n) => swarm0.receivers[n].verification_key === d.receiver.verification_key)) }, new Date(d.decided_at), { decision_id: d.decision_id, nonce: d.nonce });
  const appendEntries = (d, n, rows) => {
    const f = io(d); const es = lines(f.read(`receivers/${n}.journal.jsonl`));
    let prev = es.length ? es[es.length - 1].head : '0'.repeat(64); let seq = es.length ? es[es.length - 1].seq : 0;
    const at = es.length ? es[es.length - 1].at : new Date().toISOString();
    const added = rows.map((e) => { const partial = { seq: ++seq, at, prev, ...e }; const full = { ...partial, head: m.journalHead(prev, partial) }; prev = full.head; return full; });
    f.write(`receivers/${n}.journal.jsonl`, jsonl([...es, ...added]));
    return added;
  };
  const check = (d) => { const r = spawnSync(process.execPath, [checker, d], { encoding: 'utf8', timeout: 120_000 }); const why = /AssertionError[^:]*: ([^\n]+)/.exec(r.stderr ?? '')?.[1] ?? (r.status ? (r.stderr || '').trim().split('\n').pop() : ''); return { status: r.status, why }; };
  const ok = (name, cond) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failures++; console.log(`  ✗ ${name}`); } };

  const cases = [
    {
      id: 'resigned_unchanged', expect: 'pass', title: 'the swarm manifest re-signed, nothing changed (the control)',
      make: (d) => resign(d),
    },
    {
      id: 'refused_shown_as_committed', expect: 'refuse', title: 'a refused payment re-signed by the ledger as committed, with a payment id',
      make: (d) => {
        const f = io(d); const ds = lines(f.read('receivers/decisions.jsonl'));
        const i = ds.findIndex((x) => x.outcome === 'refused' && x.receiver.verification_key === swarm0.receivers.ledger.verification_key && String(x.spend.id).startsWith('pay:'));
        if (i < 0) throw new Error('no refused payment to alter');
        ds[i] = resignDecision(ds[i], { outcome: 'committed', reason_code: 'ok', reason: 'Committed.', next_actions: [], not_permitted: [], effect: { payment_id: 'PAY-9999' } });
        f.write('receivers/decisions.jsonl', jsonl(ds)); resign(d);
      },
    },
    {
      id: 'balances_misstated', expect: 'refuse', title: 'a committed payment re-signed with 100 more remaining than the journal holds',
      make: (d) => {
        const f = io(d); const ds = lines(f.read('receivers/decisions.jsonl'));
        const i = ds.findIndex((x) => x.outcome === 'committed' && x.receiver.verification_key === swarm0.receivers.ledger.verification_key);
        ds[i] = resignDecision(ds[i], { evidence: { ...ds[i].evidence, remaining: ds[i].evidence.remaining + 100 } });
        f.write('receivers/decisions.jsonl', jsonl(ds)); resign(d);
      },
    },
    {
      id: 'self_signed_chain_in_journal', expect: 'refuse', title: 'the ledger journal registers a chain the attacker signed for itself, and commits USD 40,000 under it, with a signed decision',
      make: (d) => {
        const ledger = receiverKey('ledger'); const attacker = m.holderFromPrivate(Buffer.from(sha('check-swarm-adversarial:attacker'), 'hex'), 'holder');
        const until = new Date(Date.now() + 3600_000).toISOString();
        const g = m.createAuthorityGrant({ principal: { ...attacker, name: 'attacker, as its own principal' }, holder: attacker, receiver: ledger, kinds: [{ action: 'pay', resource: 'vendor/*' }], dimension: 'USD', amount: 100000, expires_at: until }, new Date(), { grant_id: 'grant:attacker:self' });
        const a = m.createAllocation({ parent: g, parentHolder: attacker, holder: attacker, receiver: ledger, amount: 40000, kinds: [{ action: 'pay', resource: 'vendor/*' }] }, new Date(), { allocation_id: 'alloc:attacker:self' });
        const s = m.createSpend({ allocation: a, holder: attacker, spend_id: 'pay:V-104:E-1187', amount: 40000, action: { action: 'pay', resource: 'vendor/approved/V-104' } }, new Date());
        const base = { allocation_id: a.allocation_id, allocation_digest: a.digest, spend_id: s.spend_id, spend_digest: s.digest, amount: 40000 };
        const added = appendEntries(d, 'ledger', [
          { kind: 'registered', allocation_id: a.allocation_id, allocation_digest: a.digest, spend_id: null, spend_digest: null, amount: 40000, registered: { allocation: a, grant_amount: 100000, grant_id: g.grant_id, grant_digest: g.digest, grant: g, pin: { key_id: attacker.key_id, verification_key: attacker.verification_key } } },
          { kind: 'reserved', ...base },
          { kind: 'committed', ...base, effect: { payment_id: 'PAY-9998', invoice_id: 'INV-005', vendor_id: 'V-104', amount: 40000 } },
        ]);
        const dec = m.createReceiverDecision({ spend: { id: s.spend_id, digest: s.digest }, allocation_id: a.allocation_id, outcome: 'committed', reason_code: 'ok', reason: 'Committed: 40000 consumed.', evidence: { grant_amount: 100000, allocation_amount: 40000, consumed: 40000, reserved: 0, distributed: 0, remaining: 0 }, next_actions: [], not_permitted: [], effect: added[2].effect, journal_head: added[2].head, receiver: ledger }, new Date());
        const f = io(d); f.write('receivers/decisions.jsonl', f.read('receivers/decisions.jsonl') + `${JSON.stringify(dec)}\n`); resign(d);
      },
    },
    {
      id: 'over_allocation_in_journal', expect: 'refuse', title: 'the ledger journal registers a second allocation worth the whole grant, signed by the desk holder',
      make: (d) => {
        const f = io(d); const grant = JSON.parse(f.read('grants/ledger.json'));
        const desk = demoKey('desk-holder', 'holder'); const member = demoKey('agent:agent-1', 'holder');
        const a = m.createAllocation({ parent: grant, parentHolder: desk, holder: member, receiver: receiverKey('ledger'), amount: grant.scope.budget.amount, kinds: [{ action: 'pay', resource: 'vendor/approved/*' }] }, new Date(), { allocation_id: 'alloc:agent-1:ledger:second' });
        appendEntries(d, 'ledger', [{ kind: 'registered', allocation_id: a.allocation_id, allocation_digest: a.digest, spend_id: null, spend_digest: null, amount: a.amount, registered: { allocation: a, grant_amount: grant.scope.budget.amount, grant_id: grant.grant_id, grant_digest: grant.digest, grant, pin: { key_id: grant.principal.key_id, verification_key: grant.principal.verification_key } } }]);
        resign(d);
      },
    },
    {
      id: 'decision_withheld', expect: 'refuse', title: "a committed payment's decision withheld from decisions.jsonl",
      make: (d) => {
        const f = io(d); const ds = lines(f.read('receivers/decisions.jsonl'));
        const i = ds.findIndex((x) => x.outcome === 'committed' && x.receiver.verification_key === swarm0.receivers.ledger.verification_key);
        ds.splice(i, 1); f.write('receivers/decisions.jsonl', jsonl(ds)); resign(d);
      },
    },
    {
      id: 'pins_widened', expect: 'refuse', title: "the ledger's pinned principals widened to a second key, in keys.json and the re-signed swarm manifest",
      applies: () => Array.isArray(swarm0.receivers?.ledger?.principals),
      make: (d) => {
        const extra = m.holderFromPrivate(Buffer.from(sha('check-swarm-adversarial:attacker'), 'hex'), 'holder');
        const pin = { key_id: extra.key_id, verification_key: extra.verification_key, name: 'a second principal' };
        const f = io(d); const keys = JSON.parse(f.read('receivers/keys.json')); keys.ledger.principals = [...keys.ledger.principals, pin]; f.write('receivers/keys.json', json(keys));
        resign(d, (body) => { body.receivers.ledger.principals = [...body.receivers.ledger.principals, pin]; });
      },
    },
  ];
  for (const c of cases) {
    if (c.applies && !c.applies()) { console.log(`  · ${c.title}: not applicable to this run`); continue; }
    const d = copy(c.id);
    c.make(d);
    const r = check(d);
    const refused = r.status !== 0;
    ok(`${c.title}: ${refused ? `refused (${r.why})` : 'passed'}${(c.expect === 'refuse') === refused ? '' : c.expect === 'refuse' ? '  <- MISSED' : '  <- the control must pass'}`, (c.expect === 'refuse') === refused);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\ncheck-swarm-adversarial: ${passed} checks passed${failures ? `, ${failures} FAILED` : ''}`);
if (failures) process.exit(1);
