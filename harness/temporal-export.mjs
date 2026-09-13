#!/usr/bin/env node
/**
 * Export a run's history rules and receipts in Dogwood's formats, so the
 * reference interpreter can replay them independently of this verifier:
 *
 *   node scripts/temporal-export.mjs <run dir> [--out <dir>]
 *
 * Writes policy.dw, schema.cedarschema, trace.log, and expected.txt (one line
 * per receipt: the rule ids this verifier says fire there, or "-").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(resolve(here, existsSync(resolve(here, '../verify/legate-run.core.mjs')) ? '../verify/legate-run.core.mjs' : '../verify/legate-run.core.mjs')).href);
const args = process.argv.slice(2);
const dir = resolve(args[0] ?? '');
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const out = resolve(flag('--out', join(dir, 'temporal')));
if (!args[0] || !existsSync(join(dir, 'standard.json'))) { console.error('usage: temporal-export.mjs <run dir> [--out <dir>]'); process.exit(2); }
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const standard = read('standard.json'), manifest = read('manifest.json');
const temporal = standard.enforcement?.temporal ?? null;
if (!temporal) { console.log('the standard declares no history rules; nothing to export'); process.exit(0); }
const receipts = m.parseReceiptLog(readFileSync(join(dir, 'receipts.jsonl'), 'utf8')).receipts;
const calls = existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => ({ tool: c.tool, input: c.input })) : null;
const chain = m.verifyRunManifest(manifest, { standard, receipts, calls }).chain;
const events = m.projectEvents(chain.receipts.map((r) => ({ tool: r.tool ?? '', decision: r.decision === 'deny' ? 'deny' : 'allow', input_hash: r.input_hash ?? '', issued_at: r.issued_at ?? new Date(0).toISOString(), link: r.hash })), { attempts: manifest.attempts, calls });
const ev = m.evaluateTemporal(events, { format: temporal.format, rules: temporal.rules });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'policy.dw'), `${temporal.dogwood.policy}\n`);
writeFileSync(join(out, 'schema.cedarschema'), `${temporal.dogwood.schema}\n`);
writeFileSync(join(out, 'trace.log'), m.toDogwoodTrace(events, { format: temporal.format, rules: temporal.rules }));
const firing = events.map((e) => ev.results.filter((r) => r.evaluable && r.violations.some((v) => v.event_index === e.index)).map((r) => r.rule.id));
writeFileSync(join(out, 'expected.txt'), events.map((e, i) => `@${Math.max(0, Math.round((e.at - events[0].at) / 1000))} ${firing[i].length ? firing[i].join(',') : '-'}`).join('\n') + '\n');
console.log(`exported ${events.length} events, ${temporal.rules.length} rule(s), ${firing.filter((f) => f.length).length} firing event(s) to ${out}`);
