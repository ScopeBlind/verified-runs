# A verified run

One agent (codex-cli 0.145.0, model gpt-5.5) ran 4 tasks from terminal-bench/original-tasks at d28711d0 (a sealed task set: contents unpublished, pin public), every tool call through protect-mcp 0.13.3 under the policy compiled from the signed standard. Produced by verified-run.mjs on 2026-09-11; verified as committed by check-verified-run.mjs on every build. Demonstration keys sign the standard, the receipts, and the manifest: they prove the mechanism, not identity.

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
Run run:1c3d2cc199a86f2a, signed by Legate verified-run harness (demo) (harness:faef67591c23b631) at 2026-09-11T11:39:27.229Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: codex-cli 0.145.0, model gpt-5.5 via chatgpt.com (Codex)
Harness: legate-verified-run (sha256:63092e4125ab), gateway protect-mcp 0.13.3
Environment: Codex CLI sandbox, workspace-write, network disabled (macOS Seatbelt); egress to nothing; attestation none carried
Standard: pr:7a1e5b9c3d2f4e60, digest 139fb512e846baa0, gate policy sha256:b88a9487c62d
Receipts: 30 signed by sb:issuer:GsAFpSRUAvaU, chain head sha256:7c6993ec3466
hello-world attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 3 calls, 1 refused; 14 s
countdown-game attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 5 calls, 1 refused; 31 s
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 9.0.2, run by the harness); 10 calls, 0 refused; 54 s
assign-seats attempt 1: pass (2 passed, 0 failed, pytest 9.0.2, run by the harness); 12 calls, 1 refused; 53 s
Result: 4 of 4 passed; 30 governed calls, 3 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: pin them through a channel you already trust.
- That the sandbox enforced the declared network rule: this run carries no environment attestation, so egress and model route are the harness's declaration.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl`, or drop the three files on legate.scopeblind.com/verify.
