# A verified run

One agent (claude-code 2.1.268, model claude-sonnet-5) ran 4 tasks from terminal-bench/original-tasks at d28711d0 (a sealed task set: contents unpublished, pin public), every tool call through protect-mcp 0.13.3 under the policy compiled from the signed standard. Produced by verified-run.mjs on 2026-09-11; verified as committed by check-verified-run.mjs on every build. Demonstration keys sign the standard, the receipts, and the manifest: they prove the mechanism, not identity.

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

## Result

```
Run run:bab08b93c9611d20, signed by Legate verified-run harness (demo) (harness:faef67591c23b631) at 2026-09-11T13:46:37.609Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: claude-code 2.1.268, model claude-sonnet-5 via api.anthropic.com (Claude Code)
Harness: legate-verified-run (sha256:a21c3a9e2e0f), gateway protect-mcp 0.13.3
Environment: Claude Code sandbox, network disabled (Linux bubblewrap); egress to nothing; attestation github-actions-provenance https://github.com/ScopeBlind/verified-runs/actions/runs/34606014128
Standard: pr:7a1e5b9c3d2f4e60, digest abdc77935444ee1e, gate policy sha256:f66814a5fd94
Receipts: 18 signed by sb:issuer:GsAFpSRUAvaU, chain head sha256:f5f1a32879e4
hello-world attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 5 s
countdown-game attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 7 s
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 8.4.1, run by the harness); 7 calls, 0 refused; 47 s
assign-seats attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 9 calls, 0 refused; 57 s
Result: 4 of 4 passed; 18 governed calls, 0 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: pin them through a channel you already trust.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl`, or drop the three files on legate.scopeblind.com/verify.
