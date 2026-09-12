# A verified run

One agent (claude-code 2.1.269, model claude-sonnet-5) ran 4 tasks from terminal-bench/original-tasks at d28711d0 (a sealed task set: contents unpublished, pin public), every tool call through protect-mcp 0.13.3 under the policy compiled from the signed standard. Produced by verified-run.mjs on 2026-09-12; verified as committed by check-verified-run.mjs on every build. Demonstration keys sign the standard, the receipts, and the manifest: they prove the mechanism, not identity.

| File | What it is |
|---|---|
| standard.json | The maintainer's signed standard: allowed tools, no network, one attempt, the time limit, the task-set and harness pins, and the Cedar the gate enforced. |
| policy/standard.cedar | The policy, compiled from the standard; its digest is in the standard and in every receipt. |
| receipts.jsonl | The gateway's receipt chain: one signed receipt per attempted tool call, allowed or refused, each linked to the previous. |
| manifest.json | The harness's signed account: pins, every attempt with its receipts and test verdict, the chain head. |
| task-set.json | The pinned task set: file paths and hashes at the benchmark commit, never the files. Reference solutions were never fetched. Dockerfile RUN lines, if any, are listed as not applied. |
| harness.json | The harness pin: the digest of the harness file and the run core it runs on, as the standard names it. |
| oracle.json | The real engine's verdict on every counterexample the compiler emitted. |
| tests/ | The harness's own pytest output per task; its digest is in the manifest. |
| calls.jsonl | The call behind every receipt, in order: tool and input, bound by the input digest each receipt carries. Open it to see what each shell call did. |
| workspace/ | What the agent left in each task directory, pinned by digest in the manifest, so anyone can re-run the pinned tests on it. |
| regrade.json | A second grading, when made: the pinned tests re-run on the archived workspace, signed under a distinct grader key the standard accepts. `regrade.mjs` makes one. |

## Result

```
Run run:6e8535914100e45c, signed by Legate verified-run harness (demo) (harness:faef67591c23b631) at 2026-09-12T01:31:26.360Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: claude-code 2.1.269, model claude-sonnet-5 via api.anthropic.com (Claude Code)
Harness: legate-verified-run (sha256:f870a5d5f86c), gateway protect-mcp 0.13.3
Environment: Claude Code sandbox, network disabled (Linux bubblewrap); egress to nothing; attestation github-actions-provenance https://github.com/ScopeBlind/verified-runs/actions/runs/34664929869
Standard: pr:7a1e5b9c3d2f4e60, digest c1a76c91c228a758, gate policy sha256:f66814a5fd94
Receipts: 20 signed by sb:issuer:GsAFpSRUAvaU, chain head sha256:cdaee961dd5d; calls log sha256:f61cd9547f04 (published)
hello-world attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 2 calls, 0 refused; 10 s; workspace 1 file sha256:7b6a3d9729f9 (published)
countdown-game attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 2 calls, 0 refused; 16 s; workspace 1 file sha256:a5f6371ef68e (published)
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 8.4.1, run by the harness); 8 calls, 0 refused; 42 s; workspace 1 file sha256:bb533ad59607 (published)
assign-seats attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 8 calls, 0 refused; 75 s; workspace 1 file sha256:e2cacc100990 (published)
Result: 4 of 4 passed; 20 governed calls, 0 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: pin them through a channel you already trust.
- That the verdicts are more than the harness's word: no second grading is supplied. The archived workspace and the pinned tests let anyone make one.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl`, or drop the three files on legate.scopeblind.com/verify.

Removing a receipt from the front leaves a dangling link, which the verifier reports; removing one from the end changes the head and the count the manifest pins; a chain re-signed from scratch needs the keys, which is why the standard names them and why demonstration keys prove the mechanism only. A receipt records the call the gate saw, not what the call did: open calls.jsonl for that, and the workspace archive for what was left behind. The verdicts are the harness's own test run until a second grading reconciles them.
