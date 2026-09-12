#!/usr/bin/env node
/**
 * A verified run: one agent, one benchmark task set, every tool call through
 * the gateway under a policy compiled from a signed standard, and a signed
 * manifest at the end. What it leaves behind is checkable by anyone with the
 * three files and no account: the standard, the receipt chain, the manifest.
 *
 *   node scripts/verified-run.mjs --agent codex --tasks hello-world,countdown-game
 *   node scripts/verified-run.mjs --agent claude --tasks hello-world --model claude-sonnet-5
 *   SEALED_TASKS_KEY=... node scripts/verified-run.mjs --agent codex --tasks sealed:task-sets/terminal-bench-4.sealed.json
 *
 * The harness runs on the run core bundle beside it (verify/legate-run.core.mjs,
 * built from the site's own source), on protect-mcp from npm or from the
 * monorepo, and on nothing else. Its pin covers the harness file and the core
 * bundle together, so a reader who verifies a run is verifying exactly these
 * bytes.
 *
 * What runs, in order:
 *   1. The task set is pinned: each task's files (never the reference solution)
 *      are fetched from the benchmark repository at a fixed commit, or opened
 *      from a sealed archive with the key the maintainer holds, and digested
 *      (paths and hashes, never the contents, so the pin redistributes no
 *      benchmark data and a sealed set stays sealed).
 *   2. The harness pins itself (this file's bytes).
 *   3. The standard is built and signed by the maintainer key: allowed tools,
 *      egress, attempts, time limit, the two pins, and the model route; the
 *      compiler turns it into the Cedar the gateway enforces.
 *   4. For each task the agent runs in its own workspace with a PreToolUse hook
 *      that sends every call through protect-mcp `sign --cedar`: one chained,
 *      signed receipt per attempted call, allowed or refused, and exit 2 on a
 *      refusal so the host blocks the call. Refusals are receipted too.
 *   5. The task's own tests are run by the harness, not the agent, and the
 *      verdict is recorded with a digest of the test output.
 *   6. The manifest is signed by the harness key and everything is written to
 *      --out, where scripts/check-verified-run.mjs verifies it on every build.
 *
 * Honest limits of this demonstration, all recorded in the manifest and the
 * standard: the agent's sandbox stands in for the benchmark's Docker image
 * (task paths are rebased from /app to the workspace, and the tests are run
 * with the same rebase); no environment attestation is carried unless the run
 * is made in CI with provenance; model calls are declared, not observed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const harnessDir = dirname(here);
// The run core: creation and verification, built from the site's source and vendored beside this file.
const corePath = resolve(harnessDir, '../verify/legate-run.core.mjs');
if (!existsSync(corePath)) { console.error(`the run core is missing: ${corePath}. In the monorepo run npm run verify:build in packages/scopeblind-pm/web; in the public repository it is vendored.`); process.exit(1); }
const m = await import(pathToFileURL(corePath).href);
// protect-mcp: from npm when installed beside the harness, else the monorepo's own build.
const cli = process.env.PROTECT_MCP_CLI ?? [resolve(harnessDir, '../node_modules/protect-mcp/dist/cli.js'), resolve(harnessDir, '../../../protect-mcp/dist/cli.js')].find((p) => existsSync(p));
if (!cli) { console.error('protect-mcp is not available: install it beside the harness (npm i protect-mcp) or build packages/protect-mcp, or set PROTECT_MCP_CLI.'); process.exit(1); }
// The repository root: where .github/workflows/verified-run.yml lives, so the manifest can pin the workflow that ran.
const repoRoot = (() => { let d = harnessDir; for (let i = 0; i < 6; i++) { if (existsSync(join(d, '.github', 'workflows', 'verified-run.yml'))) return d; d = dirname(d); } return null; })();
const workflowPath = repoRoot ? join(repoRoot, '.github', 'workflows', 'verified-run.yml') : null;

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const agentName = flag('--agent', 'codex');
const tasksArg = flag('--tasks', 'hello-world');
const sealedPath = tasksArg.startsWith('sealed:') ? resolve(tasksArg.slice('sealed:'.length)) : null;
const taskIds = sealedPath ? [] : tasksArg.split(',').map((s) => s.trim()).filter(Boolean);
const outDir = resolve(flag('--out', resolve(harnessDir, '../../samples/verified-run')));
const revision = flag('--revision', 'd28711d0da2675d0bb1d56de45ae5df6082438a3');
const timeLimit = Number(flag('--time-limit', '900'));
const keepWorkspace = args.includes('--keep');
// What is published beside the run. The calls log (each tool call's input) and the archived workspaces (what the agent
// left) are disclosed by default for a public task set and held for the maintainer on a sealed one; the manifest
// carries their digests either way, so a held file is still bound.
const discloseCalls = args.includes('--disclose-calls') ? true : args.includes('--no-disclose-calls') ? false : !sealedPath;
const discloseWorkspace = args.includes('--disclose-workspace') ? true : args.includes('--no-disclose-workspace') ? false : !sealedPath;

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const sha256Bytes = (buf) => createHash('sha256').update(buf).digest('hex');

// A YAML block scalar (`key: |` or `key: |-`), dedented. task.yaml is simple enough that this is all it needs.
function blockScalar(yaml, key) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*[|>][-+]?\\s*$`).test(l));
  if (start < 0) return null;
  const body = [];
  for (const l of lines.slice(start + 1)) { if (l.trim() && !/^[ \t]/.test(l)) break; body.push(l); }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  return body.map((l) => l.slice(indent)).join('\n').trim();
}

// What the task's Dockerfile puts in the workspace. Only WORKDIR and COPY/ADD are
// reproduced; RUN lines are recorded as not applied, so a task that depends on
// one is visibly not this harness's to run. The benchmark's base images start
// in /app, which is where every task's instruction and tests point.
function parseDockerfile(text) {
  let workdir = '/app';
  const copies = []; const notApplied = [];
  for (const raw of text.replace(/\\\n/g, ' ').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [op, ...rest] = line.split(/\s+/);
    const OP = op.toUpperCase();
    if (OP === 'WORKDIR') workdir = rest[0].startsWith('/') ? rest[0] : posix.join(workdir, rest[0]);
    else if (OP === 'COPY' || OP === 'ADD') {
      if (rest.some((a) => a.startsWith('--from'))) continue;
      const args = rest.filter((a) => !a.startsWith('--'));
      const dest = args.pop();
      const abs = posix.normalize(dest.startsWith('/') ? dest : posix.join(workdir, dest));
      const intoDir = dest.endsWith('/') || dest === '.' || dest === './' || abs === workdir || args.length > 1;
      for (const src of args) copies.push({ src: src.replace(/^\.\//, '').replace(/\/$/, ''), dest: abs, intoDir });
    } else if (OP === 'RUN') notApplied.push(line);
  }
  return { workdir, copies, not_applied: notApplied };
}

// Codex runs a project's hooks only once the user has trusted them. Trust is a
// per-hook state (config `hooks.state.<hooks.json path>:<event>:<group>:<index>`
// with `trusted_hash`), and the hash is the SHA-256 of the canonical JSON of the
// normalised hook identity (codex-rs/hooks/src/engine/discovery.rs, hook_hash;
// codex-rs/config/src/fingerprint.rs, version_for_toml). The harness wrote the
// hook itself, so it supplies that state as a session flag: the same record
// the interactive client would persist after the user says yes, and nothing
// the bypass flag would skip.
const canonicalJson = (v) => (Array.isArray(v) ? v.map(canonicalJson) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalJson(v[k])])) : v);
function codexHookTrustState(hooksPath, hooksFile) {
  const state = {};
  for (const [event, groups] of Object.entries(hooksFile.hooks)) {
    const eventKey = event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    groups.forEach((g, gi) => g.hooks.forEach((h, hi) => {
      const handler = { type: 'command', command: h.command, timeout: Math.max(1, h.timeout ?? 600), async: Boolean(h.async) };
      if (h.statusMessage) handler.statusMessage = h.statusMessage;
      const identity = { event_name: eventKey, hooks: [handler] };
      if (g.matcher !== undefined && g.matcher !== null) identity.matcher = g.matcher;
      state[`${hooksPath}:${eventKey}:${gi}:${hi}`] = `sha256:${sha256(JSON.stringify(canonicalJson(identity)))}`;
    }));
  }
  return `{${Object.entries(state).map(([k, v]) => `${JSON.stringify(k)}={trusted_hash=${JSON.stringify(v)}}`).join(', ')}}`;
}

// ── The agents this harness knows how to run under the gate ─────────────────
//
// Each adapter says which host format protect-mcp speaks to it, where the
// host reads its hooks, which tool names its calls carry (the standard's
// allowlist must match them exactly), and how to run it headless. The
// sandbox line is what the manifest declares; it is the host's own sandbox,
// declared and not attested here.
const AGENTS = {
  codex: {
    name: 'codex-cli',
    format: 'codex',
    model: flag('--model', 'gpt-5.5'),
    model_route: 'chatgpt.com (Codex)',
    allowed_tools: flag('--allowed-tools', 'Bash').split(','),
    sandbox: `Codex CLI sandbox, workspace-write, network disabled (${process.platform === 'darwin' ? 'macOS Seatbelt' : process.platform === 'linux' ? 'Linux Landlock and seccomp' : process.platform})`,
    egress: [],
    version: () => (spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim().split(/\s+/).pop() ?? 'unknown'),
    hooks(ws, hook) {
      mkdirSync(join(ws, '.codex'), { recursive: true });
      const hooksFile = { hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: `node ${JSON.stringify(hook)}`, timeout: 60 }] }] } };
      const hooksPath = join(ws, '.codex', 'hooks.json');
      writeFileSync(hooksPath, `${JSON.stringify(hooksFile, null, 2)}\n`);
      return codexHookTrustState(hooksPath, hooksFile);
    },
    run(ws, instruction, model, limitSeconds, trust) {
      const last = join(ws, '.last-message.txt');
      const r = spawnSync('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-m', model, '-C', ws, '-c', 'service_tier=""', '-c', `projects.${JSON.stringify(ws)}.trust_level="trusted"`, '-c', `hooks.state=${trust}`, '-o', last, instruction], { cwd: ws, encoding: 'utf8', input: '', timeout: limitSeconds * 1000, env: { ...process.env, CODEX_HOME: process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex') } });
      return { exit_code: r.status, timed_out: r.signal === 'SIGTERM' && r.status === null, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
    },
  },
  claude: {
    name: 'claude-code',
    format: 'claude',
    model: flag('--model', 'claude-sonnet-5'),
    model_route: 'api.anthropic.com (Claude Code)',
    allowed_tools: flag('--allowed-tools', 'Bash,Read,Write,Edit').split(','),
    sandbox: `Claude Code sandbox, network disabled (${process.platform === 'darwin' ? 'macOS Seatbelt' : process.platform === 'linux' ? 'Linux bubblewrap' : process.platform})`,
    egress: [],
    version: () => (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim().split(/\s+/)[0] ?? 'unknown'),
    hooks(ws, hook) {
      mkdirSync(join(ws, '.claude'), { recursive: true });
      writeFileSync(join(ws, '.claude', 'settings.json'), `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: `node ${JSON.stringify(hook)}`, timeout: 60 }] }] }, sandbox: { enabled: true, network: { allowedDomains: [] } } }, null, 2)}\n`);
      return null;
    },
    run(ws, instruction, model, limitSeconds) {
      const env = { ...process.env }; delete env.CLAUDECODE;
      const r = spawnSync('claude', ['-p', instruction, '--model', model, '--allowedTools', 'Bash,Read,Write,Edit', '--max-turns', '40', '--output-format', 'json'], { cwd: ws, encoding: 'utf8', input: '', timeout: limitSeconds * 1000, env });
      return { exit_code: r.status, timed_out: r.signal === 'SIGTERM' && r.status === null, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
    },
  },
};
const agent = AGENTS[agentName];
if (!agent) { console.error(`unknown agent ${agentName}; one of ${Object.keys(AGENTS).join(', ')}`); process.exit(1); }

// The gate hook. Written into each workspace from this constant so the harness
// digest covers it. It records the decision first (allowed or refused, chained
// to the previous receipt) and only then blocks, so a refusal leaves a receipt.
// Hosts run tool calls in parallel, and each call is one hook process, so the
// receipt log is written under a lock: without it two receipts chain to the
// same predecessor and the chain forks, which a verifier rightly calls broken.
const GATE_HOOK = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
const [cli, format, cedar, receipts, key] = process.argv.slice(2);
const lock = receipts + '/.hook-lock'; // distinct from the lock protect-mcp 0.13.3 takes inside sign, which would otherwise wait on this one
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function acquire() {
  const started = Date.now();
  for (;;) {
    try { mkdirSync(lock); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 45000) rmSync(lock, { recursive: true, force: true }); } catch { /* raced */ }
      if (Date.now() - started > 55000) { process.stderr.write('Legate gate: could not take the receipt-log lock; refusing the call (fail closed).\\n'); process.exit(2); }
      pause(20);
    }
  }
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  acquire();
  let r; let out = null;
  try {
    r = spawnSync(process.execPath, [cli, 'sign', '--format', format, '--cedar', cedar, '--action-model', 'mcp', '--receipts', receipts, '--key', key], { input, encoding: 'utf8' });
    try { out = JSON.parse(r.stdout.trim().split('\\n').pop()); } catch { /* fall through */ }
    // The call itself, one line per receipt in the same order and under the same lock, so a reader can open the input digest each receipt carries.
    if (out && out.signed) {
      let j = null; try { j = JSON.parse(input); } catch { /* no payload */ }
      const tool = j ? (j.tool_name ?? j.toolName ?? '') : ''; const toolInput = j ? (j.tool_input ?? j.toolInput ?? {}) : {};
      appendFileSync(receipts + '/calls.jsonl', JSON.stringify({ tool, input: toolInput, decision: out.decision, request_id: out.request_id }) + '\\n');
    }
  } finally { rmSync(lock, { recursive: true, force: true }); }
  if (!out || !out.signed) { process.stderr.write('Legate gate: no signed receipt could be written; refusing the call (fail closed).\\n'); process.exit(2); }
  if (out.decision !== 'allow') {
    let tool = '?'; try { const j = JSON.parse(input); tool = j.tool_name ?? j.toolName ?? '?'; } catch { /* ignore */ }
    process.stderr.write('Legate gate refused ' + tool + ': not on the tools this run\\'s standard allows. The refusal is receipted.\\n');
    process.exit(2);
  }
  process.exit(0);
});
`;

const tmp = mkdtempSync(join(tmpdir(), 'legate-verified-run-'));
let keepTmp = false;

const gh = (path) => {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh api ${path} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const fetchBlob = (sha) => Buffer.from(gh(`repos/laude-institute/terminal-bench/git/blobs/${sha}`).content, 'base64');
const HARNESS_FILES = new Set(['task.yaml', 'run-tests.sh', 'Dockerfile', 'docker-compose.yaml', 'docker-compose.yml']);
const isSolution = (path) => /^solution(\.|$)/.test(path.split('/').pop());

try {
  const startedAt = new Date();
  console.log(`verified run: agent ${agent.name} (${agent.model}), tasks ${sealedPath ? `sealed set ${sealedPath}` : taskIds.join(', ')}`);

  // 1. Pin the task set: every file in each task's directory except the reference
  //    solution, by path and hash. The solution is never fetched, so it is never
  //    digested, never in a workspace, and never shown to the agent. A sealed
  //    set is opened with the maintainer's key and checked file by file against
  //    its public pin before anything runs.
  const tasks = [];
  let datasetName = 'terminal-bench/original-tasks';
  let datasetRevision = revision;
  let sealedPin = null;
  const rawTasks = [];
  if (sealedPath) {
    const sealed = JSON.parse(readFileSync(sealedPath, 'utf8'));
    if (sealed.type !== 'legate.sealed_task_set.v1' || sealed.alg !== 'aes-256-gcm') throw new Error(`${sealedPath} is not a sealed task set`);
    const keyHex = process.env.SEALED_TASKS_KEY ?? '';
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('SEALED_TASKS_KEY (32 bytes, hex) is required to open a sealed task set');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const body = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    datasetName = body.name; datasetRevision = body.revision;
    sealedPin = JSON.parse(readFileSync(sealedPath.replace(/\.sealed\.json$/, '.pin.json'), 'utf8'));
    for (const t of body.tasks) rawTasks.push({ id: t.id, files: Object.fromEntries(Object.entries(t.files).map(([p, b64]) => [p, Buffer.from(b64, 'base64')])) });
    console.log(`  opened sealed task set ${datasetName} (${rawTasks.length} task${rawTasks.length === 1 ? '' : 's'})`);
  }
  for (const id of taskIds) {
    const listing = gh(`repos/laude-institute/terminal-bench/contents/original-tasks/${id}?ref=${revision}`);
    if (!Array.isArray(listing)) throw new Error(`${id}: not a task directory at ${revision}`);
    const entries = [];
    for (const e of listing) {
      if (e.type === 'file') entries.push({ path: e.name, sha: e.sha });
      else if (e.type === 'dir') for (const b of gh(`repos/laude-institute/terminal-bench/git/trees/${e.sha}?recursive=1`).tree) if (b.type === 'blob') entries.push({ path: `${e.name}/${b.path}`, sha: b.sha });
    }
    const files = {};
    for (const { path, sha } of entries) if (!isSolution(path)) files[path] = fetchBlob(sha);
    rawTasks.push({ id, files });
  }
  for (const { id, files } of rawTasks) {
    const yaml = files['task.yaml']?.toString('utf8');
    if (!yaml) throw new Error(`${id}: no task.yaml at ${revision}`);
    const instruction = blockScalar(yaml, 'instruction');
    if (!instruction) throw new Error(`${id}: could not read the instruction from task.yaml`);
    const limit = Number(yaml.match(/max_agent_timeout_sec:\s*([\d.]+)/)?.[1] ?? timeLimit);
    const setup = parseDockerfile(files['Dockerfile']?.toString('utf8') ?? '');
    const assets = Object.keys(files).filter((p) => !HARNESS_FILES.has(p) && !p.startsWith('tests/'));
    const manifest = { id, files: Object.entries(files).map(([path, buf]) => ({ path, sha256: sha256Bytes(buf) })).sort((a, b) => (a.path < b.path ? -1 : 1)), assets, dockerfile_run_lines_not_applied: setup.not_applied };
    tasks.push({ id, files, instruction, limit: Math.min(limit, timeLimit), setup, assets, manifest });
    console.log(`  pinned ${id}: ${Object.keys(files).length} files${assets.length ? `, ${assets.length} asset${assets.length === 1 ? '' : 's'}` : ''}${setup.not_applied.length ? `, ${setup.not_applied.length} Dockerfile RUN line${setup.not_applied.length === 1 ? '' : 's'} not applied` : ''}`);
  }
  const datasetDigest = m.taskSetDigest(datasetName, datasetRevision, tasks.map((t) => t.manifest));
  if (sealedPin && sealedPin.digest !== datasetDigest) throw new Error(`the sealed archive does not match its public pin (${sealedPin.digest} vs ${datasetDigest}); refusing to run`);
  const taskSet = { name: datasetName, source: 'https://github.com/laude-institute/terminal-bench', revision: datasetRevision, sealed: Boolean(sealedPath), rule: `Every file in the task directory except the reference solution, which is never fetched.${sealedPath ? ' Contents are sealed; only paths and hashes are public.' : ''} Only WORKDIR and COPY lines of the Dockerfile are reproduced in the workspace; RUN lines are listed as not applied.`, tasks: tasks.map((t) => t.manifest), digest: datasetDigest };

  // 2. Pin the harness: this file and the run core it runs on, as one digest.
  const harnessFiles = [{ name: 'verified-run.mjs', sha256: sha256Bytes(readFileSync(here)) }, { name: 'legate-run.core.mjs', sha256: sha256Bytes(readFileSync(corePath)) }];
  const harnessDigest = `sha256:${m.sha256Hex(m.canonicalize({ name: 'legate-verified-run', files: harnessFiles }))}`;
  const protectVersion = spawnSync('node', [cli, 'version'], { encoding: 'utf8' }).stdout.trim();
  // The harness key signs the manifest and the grader key signs a second grading; the standard names both as accepted
  // readback sources, so a manifest or a regrade under any other key does not bind, and a regrade under the harness key is not a second party.
  const signer = m.runSignerFromSeed('legate-verified-run', 'Legate verified-run harness (demo)');
  const grader = m.runSignerFromSeed('legate-regrader', 'Legate regrader (demo)');

  // 3. The standard, signed by the maintainer key, compiled to the policy the gate enforces.
  const NOW = new Date('2026-09-11T00:00:00.000Z');
  const FAR = '2027-12-31T00:00:00.000Z';
  const maintainer = m.recipientKeyFromSeed('benchmark-maintainer', 'Benchmark maintainer', 'Terminal-Bench (demo)');
  const draft = {
    ...m.baseProofRequestDraft(NOW),
    operator: { name: 'Submitter (demo run)' },
    decision: { kind: 'reliance', owner: 'Benchmark maintainer', statement: 'Rely on this run\'s score as a verified run of the pinned task set', purpose: 'Leaderboard entry' },
    boundary: { workflow: 'Benchmark run', action_class: 'tool_call', resources: ['the task workspace'], destinations: [], period: { starts_at: NOW.toISOString(), ends_at: FAR } },
    requirements: {
      environment_class_min: 'sandbox', approver_assurance_min: 'policy_automatic',
      human_approval: { required_above: null, distinct_approvers: 1 }, authority_max_age_seconds: 900,
      coverage: 'governed_route', effect_evidence: 'independently_reconciled', anchoring: 'self_attested', partial_settlement_permitted: false,
      run: { allowed_tools: agent.allowed_tools, egress_allowlist: agent.egress, attempts_per_task: 1, dataset: { name: datasetName, revision: datasetRevision, digest: datasetDigest }, harness: { name: 'legate-verified-run', digest: harnessDigest }, time_limit_seconds: timeLimit, model_route: agent.model_route },
    },
    trust: { accepted_gate_keys: [m.GATEWAY_DEMO_PUBLIC_KEY], accepted_approver_keys: [], accepted_readback_sources: [signer.verification_key, grader.verification_key], accepted_anchor_witnesses: [] },
    disclosure: { required_fields: ['tool calls', 'verdicts', 'chain head'], inspection: 'on_request' },
    limitations_permitted: ['The agent\'s own sandbox stands in for the benchmark\'s Docker image; task paths are rebased from /app to the workspace and the tests are run with the same rebase', 'The gate clock is accepted as the dispatch time', 'No environment attestation is required for a demonstration run', 'Demonstration keys sign the standard, the receipts, the manifest, and the regrade; they prove the mechanism, not identity', 'The second grading may run in the same continuous-integration account as the first, under a distinct key and job; a grading by a third party is stronger and the archived workspace makes it possible'],
    rejection_criteria: ['Any tool call not on the allowed list that the gate allowed', 'Any gap in the receipt chain', 'More than one attempt per task', 'Any pass the agent reports that the harness\'s tests do not reproduce'],
    hold_criteria: ['A harness other than the pinned one', 'A run whose environment attestation is missing'],
    deadline: { respond_by: FAR, evidence_max_age_seconds: 30 * 24 * 3600 },
    consequence: { if_met: 'Listed as a verified run: the score stands on the receipts and the manifest, not on the submitter\'s word.', if_not_met: 'Listed as unverified, or not listed. No score is taken from this submission.', not_a_promise: true },
    claim_contract_digest: null, expires_at: FAR,
  };
  const compiled = m.compileStandard(draft);
  if (!compiled.adoptable) throw new Error(`the run standard is not adoptable: ${compiled.blockers.join('; ')}`);
  m.setDeterministicEntropy('verified-run-standard');
  const standard = m.createProofRequest({ ...draft, enforcement: m.enforcementBlock(compiled) }, maintainer, NOW, { request_id: 'pr:7a1e5b9c3d2f4e60', nonce: 'c0ffee00c0ffee00c0ffee00c0ffee02' });
  m.setDeterministicEntropy(null);
  const policyDir = join(tmp, 'policy'); mkdirSync(policyDir);
  writeFileSync(join(policyDir, compiled.cedar.file_name), compiled.cedar.policy);
  console.log(`  standard ${standard.request_id}, gate policy ${compiled.cedar.digest.slice(0, 19)}, tools ${agent.allowed_tools.join(', ')}`);

  // The engine's own verdict on every counterexample, so the JS mirror is held to it on every build.
  const oracle = [];
  for (const cx of compiled.counterexamples) {
    const r = spawnSync('node', [cli, 'evaluate', '--cedar', policyDir, '--action-model', 'mcp', '--tool', cx.tool, '--input', JSON.stringify(cx.input), '--json'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    oracle.push({ id: cx.id, tool: cx.tool, input: cx.input, expected: cx.expected, engine: out.allowed ? 'allow' : 'deny', policy_digest: out.policy_digest });
    if ((out.allowed ? 'allow' : 'deny') !== cx.expected) throw new Error(`the engine decided ${out.allowed ? 'allow' : 'deny'} for ${cx.id}; the compiler promised ${cx.expected}`);
  }
  console.log(`  engine agrees with all ${oracle.length} counterexamples`);

  // 4. The gateway key and the shared receipt log.
  const keyPath = join(tmp, 'gateway-key.json');
  writeFileSync(keyPath, JSON.stringify({ privateKey: m.GATEWAY_DEMO_SEED, publicKey: m.GATEWAY_DEMO_PUBLIC_KEY, kid: m.GATEWAY_DEMO_KID }));
  const receiptsDir = join(tmp, 'receipts'); mkdirSync(receiptsDir);
  const logPath = join(receiptsDir, 'receipts.jsonl');
  const receiptCount = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0);

  // 5. Each task, one attempt, in its own workspace, under the hook.
  const attempts = []; const testOutputs = {}; const workspaces = {};
  for (const task of tasks) {
    const ws = mkdtempSync(join(tmpdir(), `legate-task-${task.id}-`));
    mkdirSync(join(ws, 'app'));
    // The task's own files, placed where its Dockerfile would put them; remembered so the archive holds only what the agent added or changed.
    const placed = new Map();
    const place = (abs, buf) => {
      if (!abs.startsWith('/app/')) { console.log(`    not placed (outside /app): ${abs}`); return; }
      const target = join(ws, 'app', abs.slice('/app/'.length));
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, buf);
      placed.set(abs.slice('/app/'.length), sha256Bytes(buf));
    };
    for (const c of task.setup.copies) {
      const under = Object.keys(task.files).filter((p) => p === c.src || p.startsWith(`${c.src}/`));
      for (const p of under) {
        if (HARNESS_FILES.has(p) || p.startsWith('tests/')) continue;
        const rel = p === c.src ? posix.basename(p) : p.slice(c.src.length + 1);
        place(p === c.src && !c.intoDir ? c.dest : posix.join(c.dest, rel), task.files[p]);
      }
    }
    const hook = join(ws, 'legate-gate-hook.mjs');
    writeFileSync(hook, GATE_HOOK.replace("const [cli, format, cedar, receipts, key] = process.argv.slice(2);", `const [cli, format, cedar, receipts, key] = ${JSON.stringify([cli, agent.format, policyDir, receiptsDir, keyPath])};`));
    const trust = agent.hooks(ws, hook);
    const instruction = `${task.instruction.replaceAll('/app', join(ws, 'app'))}\n\nWork only inside ${ws}. Do not use the network. When the file is in place, stop.`;
    const from = receiptCount();
    const started = new Date();
    console.log(`  running ${task.id} with ${agent.name}…`);
    const run = agent.run(ws, instruction, agent.model, task.limit, trust);
    const ended = new Date();
    const to = receiptCount();
    // An agent that finished with no receipted call did its work outside the gate; that is not a governed run, whatever the tests say.
    if (to === from) {
      const tail = (s) => String(s ?? '').trim().split('\n').filter((l) => !/^(warning|20\d\d-)/.test(l)).slice(-6).join(' | ').slice(0, 900);
      // Claude Code answers in JSON whose `result` carries its own error text (an expired token, a refused tool); show that first.
      let said = '';
      try { const j = JSON.parse(String(run.stdout ?? '').trim().split('\n').pop()); said = `${j.is_error ? 'error: ' : ''}${String(j.result ?? '').slice(0, 600)}`; } catch { /* not JSON */ }
      throw new Error(`${task.id}: no governed call was receipted; the gate hook did not run. Nothing is written.\n  agent exit ${run.exit_code}${run.timed_out ? ' (timed out)' : ''}\n  agent said: ${said || '(nothing parseable)'}\n  agent stdout: ${tail(run.stdout) || '(empty)'}\n  agent stderr: ${tail(run.stderr) || '(empty)'}`);
    }
    if (run.stderr.trim()) console.log(`    agent stderr: ${run.stderr.trim().split('\n').filter((l) => !/^(warning|20\d\d-)/.test(l)).slice(-3).join(' | ').slice(0, 300)}`);
    // The harness runs the task's tests, rebased like the instruction.
    const testsDir = join(ws, '.legate-tests'); mkdirSync(testsDir);
    for (const [p, content] of Object.entries(task.files)) if (p.startsWith('tests/')) { const target = join(testsDir, p.slice('tests/'.length)); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, /\.(py|sh|txt|json|yaml|yml|csv|md)$/.test(p) ? content.toString('utf8').replaceAll('/app', join(ws, 'app')) : content); }
    const py = spawnSync('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-rA', testsDir], { cwd: ws, encoding: 'utf8', timeout: 180_000 });
    const output = `${py.stdout ?? ''}${py.stderr ?? ''}`;
    const passed = Number(output.match(/(\d+) passed/)?.[1] ?? 0); const failed = Number(output.match(/(\d+) failed/)?.[1] ?? 0) + Number(output.match(/(\d+) error/)?.[1] ?? 0);
    const verdict = py.status === 0 && passed > 0 && failed === 0 ? 'pass' : py.status === null ? 'error' : 'fail';
    const runner = `pytest ${(spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).stdout.match(/[\d.]+/) ?? ['?'])[0]}, run by the harness`;
    const chain = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(from, to).map((l) => JSON.parse(l));
    const refused = chain.filter((r) => (r.payload?.decision ?? r.decision) === 'deny').length;
    // What the agent left in the task directory: every file that is not a placed task file with its original bytes.
    const wsFiles = [];
    const walk = (dir, rel) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else if (e.isFile()) { const buf = readFileSync(p); const sha = sha256Bytes(buf); if (placed.get(r) === sha) continue; wsFiles.push({ path: r, sha256: sha, size: buf.length, ...(discloseWorkspace && buf.length <= 262_144 ? { content: buf.toString('base64') } : {}) }); } } };
    walk(join(ws, 'app'), '');
    wsFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const wsDigest = m.workspaceDigest(wsFiles);
    workspaces[task.id] = { type: 'legate.workspace_archive.v1', task_id: task.id, attempt: 1, digest: wsDigest, files: wsFiles };
    attempts.push({ task_id: task.id, attempt: 1, started_at: started.toISOString(), ended_at: ended.toISOString(), receipts: { from, to }, calls: to - from, refused, verdict, tests: { runner, passed, failed, output_digest: m.fileDigest(output) }, agent: { exit_code: run.exit_code, timed_out: run.timed_out }, workspace: { digest: wsDigest, file_count: wsFiles.length, disclosed: discloseWorkspace } });
    testOutputs[task.id] = output;
    console.log(`    ${verdict}: ${passed} passed, ${failed} failed; ${to - from} governed calls, ${refused} refused; ${Math.round((ended - started) / 1000)} s`);
    if (!keepWorkspace) rmSync(ws, { recursive: true, force: true }); else console.log(`    workspace kept at ${ws}`);
  }

  // 6. The manifest, signed by the harness key.
  const ciRunUrl = process.env.GITHUB_ACTIONS && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const receipts = logText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const callsPath = join(receiptsDir, 'calls.jsonl');
  const callsText = existsSync(callsPath) ? readFileSync(callsPath, 'utf8') : '';
  const callsLog = callsText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (callsLog.length !== receipts.length) throw new Error(`the calls log has ${callsLog.length} entries for ${receipts.length} receipts; the hook did not record every call`);
  if (!receipts.every((r) => r.signature)) throw new Error('an unsigned line is in the receipt log; the gateway key was not used');
  const manifestDraft = {
    standard: { request_id: standard.request_id, digest: standard.digest, recipient_key: standard.recipient.verification_key, policy_digest: compiled.cedar.digest },
    agent: { name: agent.name, version: agent.version(), model: agent.model, model_route: agent.model_route },
    harness: { name: 'legate-verified-run', digest: harnessDigest, gateway: `protect-mcp ${protectVersion}` },
    dataset: { name: datasetName, revision: datasetRevision, digest: datasetDigest, task_count: tasks.length },
    environment: {
      sandbox: agent.sandbox, egress: agent.egress,
      // In CI the manifest names its workflow run and the digest of the workflow file, but claims a provenance
      // attestation only when the workflow says one will be persisted (LEGATE_ATTEST): GitHub does not keep
      // attestations for user-owned private repositories, and a claim with nothing behind it would be a lie.
      attestation: process.env.LEGATE_ATTEST === 'github-actions-provenance' && ciRunUrl && workflowPath
        ? { kind: 'github-actions-provenance', reference: ciRunUrl, digest: m.fileDigest(readFileSync(workflowPath, 'utf8')) }
        : null,
      note: ciRunUrl
        ? `Run in GitHub Actions (${ciRunUrl})${process.env.LEGATE_ATTEST === 'github-actions-provenance' ? '; the provenance attestation for manifest.json, receipts.jsonl, and standard.json is on that run' : '; no provenance attestation was persisted for this repository, so the sandbox and egress are the harness\'s declaration'}. Task paths were rebased from /app to a workspace and the tests were run with the same rebase.`
        : 'Demonstration run on a developer machine: the host\'s own sandbox stood in for the benchmark\'s Docker image; task paths were rebased from /app to a workspace and the tests were run with the same rebase.',
    },
    gateway: { key_id: m.GATEWAY_DEMO_KID, verification_key: m.GATEWAY_DEMO_PUBLIC_KEY, receipt_count: receipts.length, chain_head: receipts.length ? m.chainLink(receipts[receipts.length - 1]) : null, log_digest: m.fileDigest(logText), calls_digest: m.fileDigest(callsText), calls_disclosed: discloseCalls },
    attempts,
    summary: { tasks: new Set(attempts.map((a) => a.task_id)).size, passed: attempts.filter((a) => a.verdict === 'pass').length, failed: attempts.filter((a) => a.verdict === 'fail').length, errored: attempts.filter((a) => a.verdict === 'error').length, calls: attempts.reduce((n, a) => n + a.calls, 0), refused: attempts.reduce((n, a) => n + a.refused, 0) },
  };
  const manifest = m.createRunManifest(manifestDraft, signer, new Date());
  const verification = m.verifyRunManifest(manifest, { standard, receipts, calls: callsLog.map((c) => ({ tool: c.tool, input: c.input })), workspaces: Object.fromEntries(Object.entries(workspaces).map(([id, w]) => [id, w.files])) });
  // Without a second grading the standard's verdict-evidence check is open by design; everything else must bind.
  const open = verification.checks.filter((c) => !c.ok && !c.informational && c.id !== 'verdict_evidence');
  if (open.length) {
    const chain = m.verifyActaChain(receipts, { publicKeyHex: m.GATEWAY_DEMO_PUBLIC_KEY });
    const bad = chain.receipts.filter((r) => r.signature !== 'valid' || !['genesis', 'linked', 'ok'].includes(String(r.link))).map((r) => `#${r.index} ${r.tool ?? '?'} signature=${r.signature} link=${String(r.link)}`);
    throw new Error(`the manifest does not bind: ${verification.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`).join('; ')}${bad.length ? `\n  receipts at fault: ${bad.join('; ')}` : ''}`);
  }

  // 7. Write everything a verifier needs, and nothing else.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'policy'), { recursive: true }); mkdirSync(join(outDir, 'tests'));
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  const heldDir = `${outDir}-held`;
  if (!discloseCalls || !discloseWorkspace) { rmSync(heldDir, { recursive: true, force: true }); mkdirSync(join(heldDir, 'workspace'), { recursive: true }); }
  writeFileSync(join(discloseCalls ? outDir : heldDir, 'calls.jsonl'), callsText);
  mkdirSync(join(outDir, 'workspace'));
  for (const [id, w] of Object.entries(workspaces)) writeFileSync(join(discloseWorkspace ? outDir : heldDir, 'workspace', `${id}.json`), json(discloseWorkspace ? w : { ...w, files: w.files.map(({ content, ...rest }) => rest) }));
  if (!discloseWorkspace) for (const [id, w] of Object.entries(workspaces)) writeFileSync(join(outDir, 'workspace', `${id}.json`), json({ ...w, files: w.files.map(({ content, ...rest }) => rest), held: true }));
  writeFileSync(join(outDir, 'standard.json'), json(standard));
  writeFileSync(join(outDir, 'policy', compiled.cedar.file_name), compiled.cedar.policy);
  writeFileSync(join(outDir, 'receipts.jsonl'), logText);
  writeFileSync(join(outDir, 'receipts.json'), json(receipts));
  writeFileSync(join(outDir, 'manifest.json'), json(manifest));
  writeFileSync(join(outDir, 'task-set.json'), json(taskSet));
  writeFileSync(join(outDir, 'harness.json'), json({ name: 'legate-verified-run', digest: harnessDigest, files: harnessFiles, gateway: `protect-mcp ${protectVersion}`, rule: 'The digest is over the canonical JSON of {name, files:[{name, sha256}]}; the files are the harness and the run core it runs on.' }));
  writeFileSync(join(outDir, 'oracle.json'), json(oracle));
  writeFileSync(join(outDir, 'gateway-signer.json'), json({ kid: m.GATEWAY_DEMO_KID, public_key: m.GATEWAY_DEMO_PUBLIC_KEY, note: 'Demonstration gateway key: the seed is public (gateway-demo-key.ts). Real signatures, demo identity.' }));
  writeFileSync(join(outDir, 'harness-signer.json'), json({ key_id: signer.key_id, public_key: signer.verification_key, note: 'Demonstration harness key: the seed is public (run-manifest.ts). Real signatures, demo identity.' }));
  for (const [id, output] of Object.entries(testOutputs)) writeFileSync(join(outDir, 'tests', `${id}.txt`), output);
  writeFileSync(join(outDir, 'README.md'), [
    '# A verified run',
    '',
    `One agent (${agent.name} ${manifest.agent.version}, model ${agent.model}) ran ${tasks.length} task${tasks.length === 1 ? '' : 's'} from ${datasetName} at ${datasetRevision.slice(0, 8)}${sealedPath ? ' (a sealed task set: contents unpublished, pin public)' : ''}, every tool call through protect-mcp ${protectVersion} under the policy compiled from the signed standard. Produced by verified-run.mjs on ${startedAt.toISOString().slice(0, 10)}; verified as committed by check-verified-run.mjs on every build. Demonstration keys sign the standard, the receipts, and the manifest: they prove the mechanism, not identity.`,
    '',
    '| File | What it is |',
    '|---|---|',
    '| standard.json | The maintainer\'s signed standard: allowed tools, no network, one attempt, the time limit, the task-set and harness pins, and the Cedar the gate enforced. |',
    '| policy/standard.cedar | The policy, compiled from the standard; its digest is in the standard and in every receipt. |',
    '| receipts.jsonl | The gateway\'s receipt chain: one signed receipt per attempted tool call, allowed or refused, each linked to the previous. |',
    '| manifest.json | The harness\'s signed account: pins, every attempt with its receipts and test verdict, the chain head. |',
    '| task-set.json | The pinned task set: file paths and hashes at the benchmark commit, never the files. Reference solutions were never fetched. Dockerfile RUN lines, if any, are listed as not applied. |',
    '| harness.json | The harness pin: the digest of the harness file and the run core it runs on, as the standard names it. |',
    '| oracle.json | The real engine\'s verdict on every counterexample the compiler emitted. |',
    '| tests/ | The harness\'s own pytest output per task; its digest is in the manifest. |',
    `| calls.jsonl | ${discloseCalls ? 'The call behind every receipt, in order: tool and input, bound by the input digest each receipt carries. Open it to see what each shell call did.' : 'Held by the maintainer (sealed task set); its digest is in the manifest.'} |`,
    `| workspace/ | ${discloseWorkspace ? 'What the agent left in each task directory, pinned by digest in the manifest, so anyone can re-run the pinned tests on it.' : 'Paths and digests only; the contents are held by the maintainer (sealed task set).'} |`,
    '| regrade.json | A second grading, when made: the pinned tests re-run on the archived workspace, signed under a distinct grader key the standard accepts. `regrade.mjs` makes one. |',
    '',
    '## Result',
    '',
    '```',
    m.runManifestReadback(manifest),
    '```',
    '',
    '## What this does not establish',
    '',
    ...verification.not_established.map((n) => `- ${n}`),
    '',
    'Verify offline: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl`, or drop the three files on legate.scopeblind.com/verify.',
    '',
    'Removing a receipt from the front leaves a dangling link, which the verifier reports; removing one from the end changes the head and the count the manifest pins; a chain re-signed from scratch needs the keys, which is why the standard names them and why demonstration keys prove the mechanism only. A receipt records the call the gate saw, not what the call did: open calls.jsonl for that, and the workspace archive for what was left behind. The verdicts are the harness\'s own test run until a second grading reconciles them.',
    '',
  ].join('\n'));
  console.log(`\n${verification.title}\n${m.runManifestReadback(manifest)}\n\nwritten to ${outDir}`);
} catch (err) {
  console.error(`\nverified run failed: ${err.message}\nevidence kept at ${tmp}`);
  process.exitCode = 1;
  keepTmp = true;
} finally {
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true });
}
