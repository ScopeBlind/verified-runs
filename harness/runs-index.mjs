#!/usr/bin/env node
/** Print the runs index (Markdown) from the run folders: agent and model, result, who graded, whose keys, where it was made. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const base = process.argv[2] ?? 'runs';
const rows = readdirSync(base).sort().filter((n) => existsSync(join(base, n, 'manifest.json'))).map((n) => {
  const m = JSON.parse(readFileSync(join(base, n, 'manifest.json'), 'utf8'));
  const s = JSON.parse(readFileSync(join(base, n, 'standard.json'), 'utf8'));
  const outside = existsSync(join(base, n, 'regrades')) ? readdirSync(join(base, n, 'regrades')).filter((g) => existsSync(join(base, n, 'regrades', g, 'regrade.json'))) : [];
  const graded = ['the harness', existsSync(join(base, n, 'regrade.json')) ? 'a separate job' : null, ...outside.map((g) => g.replace(/-verified-runs-grader$/, '').replace(/^veritasacta$/, 'VeritasActa'))].filter(Boolean).join(', ');
  const keys = /demo/i.test(s.recipient.organization) ? 'demonstration' : 'published';
  const att = m.environment.attestation?.reference;
  const model = m.model_calls ? `${m.agent.model} (attested)` : m.agent.model;
  return `| [${n.replace(/-ci-attested-/, '-ci-').slice(0, 44)}${n.length > 44 ? '…' : ''}](runs/${n}) | ${m.agent.name.replace(/^legate-/, '')}, ${model} | ${m.summary.passed} of ${m.summary.tasks} | ${graded} | ${keys} | ${att ? `[CI](${att})` : 'a laptop'} |`;
});
console.log(['| Run | Agent, model | Passed | Graded by | Keys | Made in |', '|---|---|---|---|---|---|', ...rows.reverse()].join('\n'));
