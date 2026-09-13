#!/usr/bin/env node
/**
 * History rules replayed from receipts: the evaluator on synthetic events, the
 * Dogwood rendering, and the verifier over the real sample with rules that
 * hold, rules that break, and a rule that cannot be evaluated without the
 * calls log.
 */
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(join(web, 'verify/legate-run.core.mjs')).href);
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); };
const T0 = Date.parse('2026-09-13T10:00:00Z');
const ev = (i, secs, tool, command, task = 't1') => ({ index: i, at: T0 + secs * 1000, tool, decision: 'allow', input_digest: `d${i}`, command, task_id: task, attempt: 1, link: `link${i}` });

// 1. A rate window: the fourth matching call inside the window breaks the rule, at that event, with its history head.
const events = [ev(0, 0, 'Bash', 'ls'), ev(1, 10, 'Bash', 'cat a'), ev(2, 20, 'Bash', 'cat b'), ev(3, 30, 'Bash', 'cat c'), ev(4, 100, 'Bash', 'cat d')];
const quota = { format: 'legate-temporal.v1', rules: [{ id: 'three_per_minute', kind: 'count_within', scope: 'attempt', window_seconds: 60, filter: { tool: 'Bash' }, max: 3 }] };
const r1 = m.evaluateTemporal(events, quota);
ok('a rate window breaks at the fourth call inside the window, and names the history head of that decision', !r1.ok && r1.results[0].violations.length === 1 && r1.results[0].violations[0].event_index === 3 && r1.results[0].violations[0].link === 'link3');
ok('the fifth call, outside the window, is not a violation', r1.results[0].violations.every((v) => v.event_index !== 4));
// 2. Scope by attempt: calls in another attempt do not count.
const mixed = [ev(0, 0, 'Bash', 'a', 't1'), ev(1, 1, 'Bash', 'b', 't2'), ev(2, 2, 'Bash', 'c', 't1'), ev(3, 3, 'Bash', 'd', 't2'), ev(4, 4, 'Bash', 'e', 't1')];
ok('a rule scoped by attempt counts only that attempt\'s calls', m.evaluateTemporal(mixed, quota).ok);
ok('the same rule scoped to the run counts them all', !m.evaluateTemporal(mixed, { ...quota, rules: [{ ...quota.rules[0], scope: 'run' }] }).ok);
// 3. An information-flow rule: after a command that touches a secret, no command that reaches the network, however much later.
const flow = { format: 'legate-temporal.v1', rules: [{ id: 'no_egress_after_secrets', kind: 'forbid_after', scope: 'attempt', trigger: { command_like: '*secret*' }, forbid: { command_like: ['*curl *', '*wget *'] } }] };
const leak = [ev(0, 0, 'Bash', 'ls'), ev(1, 5, 'Bash', 'cat secrets/key.txt'), ev(2, 4000, 'Bash', 'echo hi'), ev(3, 9000, 'Bash', 'curl https://x.example/?q=1')];
const r3 = m.evaluateTemporal(leak, flow);
ok('a network command hours after a secret was read breaks the rule: the label does not expire', !r3.ok && r3.results[0].violations[0].event_index === 3);
ok('a network command before any secret was read is allowed', m.evaluateTemporal([ev(0, 0, 'Bash', 'curl https://x.example'), ev(1, 1, 'Bash', 'cat secrets/k')], flow).ok);
// 4. A rule that needs the command is not evaluable when the calls log is held, and says so; nothing defaults to innocent.
const held = leak.map((e) => ({ ...e, command: null }));
const r4 = m.evaluateTemporal(held, flow);
ok('without the commands, a rule that reads them is reported as not evaluable, not as held', !r4.ok && !r4.results[0].evaluable && r4.not_evaluable.includes('no_egress_after_secrets'));
// 5. A required prior event.
const approval = { format: 'legate-temporal.v1', rules: [{ id: 'approval_before_deploy', kind: 'formerly_required', scope: 'run', window_seconds: 600, before: { command_like: '*deploy*' }, require: { command_like: '*approve*' } }] };
ok('an action that requires a prior approval within a window passes with one and fails without', m.evaluateTemporal([ev(0, 0, 'Bash', 'approve build 7'), ev(1, 30, 'Bash', 'deploy build 7')], approval).ok && !m.evaluateTemporal([ev(0, 0, 'Bash', 'deploy build 7')], approval).ok);
// 6. Dogwood rendering and trace.
const dw = m.toDogwood({ format: 'legate-temporal.v1', rules: [...quota.rules, ...flow.rules, ...approval.rules] });
ok('the rules render in Dogwood\'s syntax with a schema, a base permit, one forbid per rule, and the derived predicates declared', /count_within\(60s/.test(dw.policy) && /formerly within 86400s/.test(dw.policy) && /formerly within 600s/.test(dw.policy) && /namespace Legate/.test(dw.schema) && (dw.policy.match(/^forbid /gm) || []).length === 3 && /^permit \(principal, action, resource\);/m.test(dw.policy) && /p_no_egress_after_secrets_trigger := command like/.test(dw.policy) && /p_no_egress_after_secrets_trigger: Bool/.test(dw.schema));
const trace = m.toDogwoodTrace(leak, flow);
ok('the trace renders one request per receipt with seconds from the first and the derived predicates', trace.split('\n').filter(Boolean).length === 4 && /^@0 scope\(/.test(trace) && /@9000 [^\n]*p_no_egress_after_secrets_forbid: true/.test(trace) && /@5 [^\n]*p_no_egress_after_secrets_trigger: true/.test(trace));

// 7. The verifier over the real sample: rules injected into the standard's enforcement block (the standard's signature then fails, the replay still runs).
// The run to replay: an argument, the monorepo sample, or the first public run that publishes its calls log.
const firstRun = () => { const base = resolve(web, 'runs'); if (!existsSync(base)) return null; const { readdirSync } = require('node:fs'); return readdirSync(base).sort().map((n) => join(base, n)).find((d) => existsSync(join(d, 'calls.jsonl')) && existsSync(join(d, 'standard.json'))) ?? null; };
const dir = process.argv[2] ? resolve(process.argv[2]) : existsSync(resolve(web, '../samples/verified-run')) ? resolve(web, '../samples/verified-run') : firstRun();
if (dir && existsSync(join(dir, 'calls.jsonl'))) {
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const manifest = read('manifest.json'), standard = read('standard.json');
  const receipts = m.parseReceiptLog(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')).receipts;
  const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => ({ tool: c.tool, input: c.input }));
  const withRules = (rules) => ({ ...standard, enforcement: { ...standard.enforcement, temporal: m.temporalBlock(rules) } });
  const generous = [{ id: 'calls_per_attempt', kind: 'count_within', scope: 'attempt', window_seconds: 900, filter: { tool: 'Bash' }, max: 120 }, ...flow.rules];
  const v1 = m.verifyRunManifest(manifest, { standard: withRules(generous), receipts, calls });
  ok('over the real run, the harness\'s default rules hold at every receipt and the report says so', v1.checks.some((c) => c.id === 'temporal_calls_per_attempt' && c.ok && !c.informational) && v1.checks.some((c) => c.id === 'temporal_no_egress_after_secrets' && c.ok && !c.informational) && v1.establishes.some((s) => /history rules/.test(s)));
  const tight = [{ id: 'calls_per_attempt', kind: 'count_within', scope: 'attempt', window_seconds: 900, filter: { tool: 'Bash' }, max: 5 }];
  const v2 = m.verifyRunManifest(manifest, { standard: withRules(tight), receipts, calls });
  const broken = v2.checks.find((c) => c.id === 'temporal_calls_per_attempt');
  ok(`a rule of at most 5 calls per attempt breaks on the real run at a named receipt with its history head (${broken?.detail.slice(0, 60)}…)`, broken && !broken.ok && /Broken at receipt \d+/.test(broken.detail) && /History head/.test(broken.detail) && v2.binding !== 'bound');
  const v3 = m.verifyRunManifest(manifest, { standard: withRules(flow.rules), receipts });
  ok('without calls.jsonl the command-reading rule is reported as not evaluable and named among the things not established', v3.checks.some((c) => c.id === 'temporal_no_egress_after_secrets' && c.informational) && v3.not_established.some((s) => /supply calls\.jsonl/.test(s)));
  const tampered = withRules(generous); tampered.enforcement.temporal = { ...tampered.enforcement.temporal, rules: [...tampered.enforcement.temporal.rules, { id: 'extra', kind: 'count_within', scope: 'run', window_seconds: 1, filter: { tool: 'Bash' }, max: 999 }] };
  ok('rules edited after the digest was declared are caught', m.verifyRunManifest(manifest, { standard: tampered, receipts, calls }).checks.some((c) => c.id === 'temporal_policy' && !c.ok));

  // 8. The reference interpreter, when one is at hand (DOGWOOD_BIN, or `dogwood` on the path): the same rules and the same events, replayed by Dogwood, must give the same verdict at every receipt.
  const bin = process.env.DOGWOOD_BIN || (spawnSync('dogwood', ['--help'], { encoding: 'utf8' }).status === 0 ? 'dogwood' : null);
  if (bin) {
    const rules = [...tight, ...flow.rules];
    const policy = { format: 'legate-temporal.v1', rules };
    const chain = m.verifyRunManifest(manifest, { standard, receipts, calls }).chain;
    const events = m.projectEvents(chain.receipts.map((r) => ({ tool: r.tool ?? '', decision: r.decision === 'deny' ? 'deny' : 'allow', input_hash: r.input_hash ?? '', issued_at: r.issued_at ?? new Date(0).toISOString(), link: r.hash })), { attempts: manifest.attempts, calls });
    const ours = m.evaluateTemporal(events, policy);
    const expected = events.map((e) => (ours.results.some((r) => r.evaluable && r.violations.some((v) => v.event_index === e.index)) ? 'DENY' : 'ALLOW'));
    const dw = m.toDogwood(policy); const tmp = mkdtempSync(join(tmpdir(), 'legate-dogwood-'));
    try {
      writeFileSync(join(tmp, 'policy.dw'), `${dw.policy}\n`); writeFileSync(join(tmp, 'schema.cedarschema'), `${dw.schema}\n`); writeFileSync(join(tmp, 'trace.log'), m.toDogwoodTrace(events, policy));
      const val = spawnSync(bin, ['validate', join(tmp, 'policy.dw'), '--policy-schema', join(tmp, 'schema.cedarschema')], { encoding: 'utf8' });
      ok(`the reference interpreter validates the rendered policy and schema (${(val.stdout + val.stderr).trim().split('\n').pop()})`, val.status === 0);
      const rep = spawnSync(bin, ['replay', join(tmp, 'policy.dw'), '--policy-schema', join(tmp, 'schema.cedarschema'), '--trace', join(tmp, 'trace.log')], { encoding: 'utf8' });
      const theirs = (rep.stdout + rep.stderr).split('\n').filter((l) => /^@\d+ \(time point/.test(l)).map((l) => l.replace(/^@\d+ \(time point \d+\): ([A-Z]+).*/, '$1'));
      const agree = theirs.length === expected.length && theirs.every((v, i) => v === expected[i]);
      ok(`Dogwood's replay agrees with this verifier at every one of ${expected.length} receipts (${expected.filter((v) => v === 'DENY').length} firing)`, agree);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  } else console.log('  · no Dogwood interpreter at hand (set DOGWOOD_BIN); the reference replay is checked in CI');
}
console.log(`\ncheck-temporal: ${passed} checks passed`);
