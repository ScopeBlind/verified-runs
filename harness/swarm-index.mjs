#!/usr/bin/env node
/** Print the swarm runs index (Markdown) from swarm/: configuration, agents, unauthorized effects, completion, false blocks, cost, where it was made. Newest first. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const base = process.argv[2] ?? 'swarm';
const runs = existsSync(base) ? readdirSync(base).filter((n) => existsSync(join(base, n, 'swarm.json'))) : [];
const rows = runs.map((n) => {
  const s = JSON.parse(readFileSync(join(base, n, 'swarm.json'), 'utf8'));
  const o = JSON.parse(readFileSync(join(base, n, 'outcomes.json'), 'utf8'));
  const members = Object.values(s.members);
  const agents = members.filter((m) => m.role !== 'attacker').length;
  const model = [...new Set(Object.keys(s.members).filter((id) => existsSync(join(base, n, 'agents', id, 'model-calls.jsonl'))).map(() => 'attested'))].length ? `${agents} attested agents` : `${agents} procedural agents`;
  const lc = o.legitimate_completion;
  const made = s.attestation?.reference ? `[CI](${s.attestation.reference})` : 'a laptop';
  return { at: s.made_at, row: `| [${n.slice(0, 28)}${n.length > 28 ? '…' : ''}](swarm/${n}) | ${s.config} | ${model}${members.some((m) => m.role === 'attacker') ? ' + attacker' : ''} | ${o.unauthorized_effects.count} | ${lc.paid_correctly} of ${lc.of} | ${lc.declined_correctly} of ${lc.to_decline} | ${lc.impossible_invoice} | ${o.false_blocks.count} | ${o.attacker ? (o.attacker.all_matched ? 'all' : 'NOT all') : '-'} | USD ${o.cost.usd} | ${made} |` };
}).sort((a, b) => b.at.localeCompare(a.at)).map((r) => r.row);
console.log(['| Run | Config | Members | Unauthorized effects | Legit paid | Declined right | Impossible invoice | False blocks | Attacker as expected | Cost | Made in |', '|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n'));

// --latest: the comparison table, one column per configuration, from the newest attested run of each.
if (process.argv.includes('--latest')) {
  const latest = {};
  for (const n of runs) {
    const s = JSON.parse(readFileSync(join(base, n, 'swarm.json'), 'utf8'));
    if (!Object.keys(s.members).some((id) => existsSync(join(base, n, 'agents', id, 'model-calls.jsonl')))) continue;
    if (!latest[s.config] || s.made_at > latest[s.config].s.made_at) latest[s.config] = { n, s, o: JSON.parse(readFileSync(join(base, n, 'outcomes.json'), 'utf8')) };
  }
  const cfgs = ['A', 'B', 'C'].filter((c) => latest[c]);
  const row = (label, f) => `| ${label} | ${cfgs.map((c) => f(latest[c].o, latest[c].s, latest[c].n)).join(' | ')} |`;
  const byAgent = (o, role) => o.unauthorized_effects.items.filter((u) => u.agent === role).length;
  console.log('');
  console.log(`| | ${cfgs.map((c) => `${c} ([run](swarm/${latest[c].n}))`).join(' | ')} |`);
  console.log(`|---|${cfgs.map(() => '---').join('|')}|`);
  console.log(row('Unauthorized effects at the services', (o) => { const att = byAgent(o, 'attacker'); const agents = o.unauthorized_effects.count - att; return o.unauthorized_effects.count === 0 ? '0' : `${o.unauthorized_effects.count} (${agents} by model agents, ${att} by the attacker)`; }));
  console.log(row('Legitimate invoices paid correctly', (o) => `${o.legitimate_completion.paid_correctly} of ${o.legitimate_completion.of}`));
  console.log(row('Invoices that had to be declined, declined with the right reason', (o) => `${o.legitimate_completion.declined_correctly} of ${o.legitimate_completion.to_decline}`));
  console.log(row('The impossible invoice', (o) => o.legitimate_completion.impossible_invoice.replace(/_/g, ' ')));
  console.log(row('Legitimate requests refused', (o) => String(o.false_blocks.count)));
  console.log(row('Instructions planted in shared memory', (o) => String(o.planted_notes.length)));
  console.log(row('Scripted attacker, steps and probes as expected', (o) => o.attacker ? (o.attacker.all_matched ? `all ${o.attacker.steps.length + o.attacker.probes.length}` : 'NOT all') : '-'));
  console.log(row('Cost', (o) => `USD ${o.cost.usd.toFixed(2)}`));
}
