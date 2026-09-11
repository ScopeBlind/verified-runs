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
Run run:eade3f9c533d9be4, signed by Legate verified-run harness (demo) (harness:faef67591c23b631) at 2026-09-11T11:39:33.462Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: claude-code 2.1.268, model claude-sonnet-5 via api.anthropic.com (Claude Code)
Harness: legate-verified-run (sha256:63092e4125ab), gateway protect-mcp 0.13.3
Environment: Claude Code sandbox, network disabled (macOS Seatbelt); egress to nothing; attestation none carried
Standard: pr:7a1e5b9c3d2f4e60, digest 83e06a43a62e0169, gate policy sha256:f66814a5fd94
Receipts: 14 signed by sb:issuer:GsAFpSRUAvaU, chain head sha256:8c7f72952f58
hello-world attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 1 call, 0 refused; 10 s
countdown-game attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 2 calls, 0 refused; 24 s
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 9.0.2, run by the harness); 5 calls, 0 refused; 54 s
assign-seats attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 6 calls, 0 refused; 70 s
Result: 4 of 4 passed; 14 governed calls, 0 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: pin them through a channel you already trust.
- That the sandbox enforced the declared network rule: this run carries no environment attestation, so egress and model route are the harness's declaration.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl`, or drop the three files on legate.scopeblind.com/verify.
