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
