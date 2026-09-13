#!/usr/bin/env node
/**
 * The hardened grader against a clean submission, a submission that plants
 * scoring-hijack configuration, a submission that tries to end the scoring
 * interpreter with a clean status, and the two grading profiles.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(join(web, 'verify/legate-run.core.mjs')).href);
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); };
if (spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status !== 0) { console.log('check-grading: pytest is not installed here; skipped'); process.exit(0); }

const ws = () => { const d = mkdtempSync(join(tmpdir(), 'legate-grading-check-')); mkdirSync(join(d, 'app'), { recursive: true }); return d; };
const blackBoxTests = { 'tests/test_cli.py': `import subprocess, sys\ndef test_prints_hello():\n    out = subprocess.run([sys.executable, '<APP>/hello.py'], capture_output=True, text=True)\n    assert out.stdout.strip() == 'hello'\n` };
const inProcessTests = { 'tests/test_lib.py': `import sys\nsys.path.insert(0, '<APP>')\nimport solution\ndef test_add():\n    assert solution.add(2, 3) == 5\n` };
const rebase = (tests, d) => Object.fromEntries(Object.entries(tests).map(([p, c]) => [p, c.replaceAll('<APP>', join(d, 'app'))]));

try {
  // 1. A clean black-box submission passes; the three views agree; the profile is black box.
  const a = ws(); writeFileSync(join(a, 'app', 'hello.py'), "print('hello')\n");
  const ra = m.gradeWorkspace({ workspace: a, tests: rebase(blackBoxTests, a), timeoutMs: 60_000 });
  ok(`a clean black-box submission passes (${ra.passed} passed) with the summary, JUnit, and exit status agreeing`, ra.verdict === 'pass' && ra.grading.profile === 'black_box' && ra.grading.cross_check.consistent && ra.grading.hygiene.refused.length === 0);
  // 2. An in-process task is graded and declared as the weaker profile.
  const b = ws(); writeFileSync(join(b, 'app', 'solution.py'), 'def add(x, y):\n    return x + y\n');
  const rb = m.gradeWorkspace({ workspace: b, tests: rebase(inProcessTests, b), timeoutMs: 60_000 });
  ok('an in-process task passes and is declared in_process: the tests import the submission', rb.verdict === 'pass' && rb.grading.profile === 'in_process' && rb.grading.cross_check.consistent);
  // 3. A wrong submission fails, consistently.
  const c = ws(); writeFileSync(join(c, 'app', 'solution.py'), 'def add(x, y):\n    return x - y\n');
  const rc = m.gradeWorkspace({ workspace: c, tests: rebase(inProcessTests, c), timeoutMs: 60_000 });
  ok('a wrong submission fails, with the three views agreeing on the failure', rc.verdict === 'fail' && rc.failed === 1 && rc.grading.cross_check.consistent);
  // 4. Scoring-hijack configuration in the workspace is refused before any test runs.
  const d = ws(); writeFileSync(join(d, 'app', 'solution.py'), 'def add(x, y):\n    return x - y\n'); writeFileSync(join(d, 'app', 'conftest.py'), "import pytest\n@pytest.hookimpl(tryfirst=True)\ndef pytest_runtest_makereport(item, call):\n    pass\n");
  const rd = m.gradeWorkspace({ workspace: d, tests: rebase(inProcessTests, d), timeoutMs: 60_000 });
  ok('a planted conftest.py is refused before any test runs, and the verdict is fail', rd.verdict === 'fail' && rd.grading.hygiene.refused.includes('conftest.py') && rd.passed === 0);
  const e = ws(); writeFileSync(join(e, 'app', 'solution.py'), 'def add(x, y):\n    return x - y\n'); writeFileSync(join(e, 'app', 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-p no:terminal"\n');
  ok('a planted pyproject.toml pytest section is refused', m.gradeWorkspace({ workspace: e, tests: rebase(inProcessTests, e), timeoutMs: 60_000 }).grading.hygiene.refused.includes('pyproject.toml'));
  // 5. A submission that ends the scoring interpreter with a clean status during import does not pass: the views disagree.
  const f = ws(); writeFileSync(join(f, 'app', 'solution.py'), "import os\nprint('1 passed')\nos._exit(0)\n");
  const rf = m.gradeWorkspace({ workspace: f, tests: rebase(inProcessTests, f), timeoutMs: 60_000 });
  ok(`a submission that exits the interpreter with status 0 during import does not pass (${rf.verdict}: ${rf.grading.cross_check.consistent ? 'consistent' : 'the cross-check caught it'})`, rf.verdict !== 'pass');
  // 6. A submission that prints a fake summary line does not pass either.
  const g = ws(); writeFileSync(join(g, 'app', 'solution.py'), "print('===== 5 passed in 0.01s =====')\ndef add(x, y):\n    return x - y\n");
  const rg = m.gradeWorkspace({ workspace: g, tests: rebase(inProcessTests, g), timeoutMs: 60_000 });
  ok(`a submission that prints a fake pytest summary does not pass (${rg.verdict})`, rg.verdict !== 'pass');
  console.log(`\ncheck-grading: ${passed} checks passed`);
} finally { /* temp workspaces are small; left to the OS temp cleaner */ }
