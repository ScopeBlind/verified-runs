# A verified run

One agent (legate-attested-loop legate-attested-loop 1.0, model Qwen/Qwen3.8-27B) ran 4 tasks from terminal-bench/original-tasks at d28711d0, every tool call through protect-mcp 0.13.3 under the policy compiled from the signed standard. Produced by verified-run.mjs on 2026-09-12; verified as committed by check-verified-run.mjs on every build. Demonstration keys sign the standard, the receipts, and the manifest: they prove the mechanism, not identity.

| File | What it is |
|---|---|
| standard.json | The maintainer's signed standard: allowed tools, no network, one attempt, the time limit, the task-set and harness pins, and the Cedar the gate enforced. |
| policy/standard.cedar | The policy, compiled from the standard; its digest is in the standard and in every receipt. |
| receipts.jsonl | The gateway's receipt chain: one signed receipt per attempted tool call, allowed or refused, each linked to the previous. |
| manifest.json | The harness's signed account: pins, every attempt with its receipts and test verdict, the chain head. |
| task-set.json | The pinned task set: file paths and hashes at the benchmark commit, never the files. Reference solutions were never fetched. Dockerfile RUN lines, if any, are listed as not applied. |
| harness.json | The harness pin: the digest of the harness file and the run core it runs on, as the standard names it. |
| model-calls.jsonl | The harness, signed by the model's TEE | One record per model call: the digests of the exact request and response bytes, the TEE's signature over them, and the signing address. The manifest pins the log by digest and each attempt names its range. |
| model-attestation.json | The inference provider | The attestation report for each signing address: an Intel TDX quote whose report_data binds the signing key, verified offline against Intel's root; the manifest pins each report by digest. |
| model-calls-bodies.jsonl | The harness | The request and response bytes behind each record, published or held (held bodies stay with the maintainer; the digests bind them either way). |
| provenance/ | GitHub Actions (when the run was made there) | Sigstore bundles for manifest.json, receipts.jsonl, standard.json, and regrade.json: the workflow, repository, commit, and run that produced these bytes, verified offline against the pinned Sigstore trust root by the verifier, or independently with gh attestation verify. |
| oracle.json | The real engine's verdict on every counterexample the compiler emitted. |
| tests/ | The harness's own pytest output per task; its digest is in the manifest. |
| calls.jsonl | The call behind every receipt, in order: tool and input, bound by the input digest each receipt carries. Open it to see what each shell call did. |
| workspace/ | What the agent left in each task directory, pinned by digest in the manifest, so anyone can re-run the pinned tests on it. |
| regrade.json | A second grading, when made: the pinned tests re-run on the archived workspace, signed under a distinct grader key the standard accepts. `regrade.mjs` makes one. |

## Result

```
Run run:00856fa42e6ae290, signed by Legate verified-run harness (demo) (harness:faef67591c23b631) at 2026-09-12T06:49:15.240Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: legate-attested-loop legate-attested-loop 1.0, model Qwen/Qwen3.8-27B via cloud-api.near.ai (attested TDX inference); attested: 17 model calls signed inside near-ai-cloud's TEE for Qwen/Qwen3.8-27B, 1 report
Harness: legate-verified-run (sha256:fc332366a733), gateway protect-mcp 0.13.3
Environment: Linux bubblewrap for tool commands (network disabled); the harness makes the model calls over TLS to the attested provider; egress to cloud-api.near.ai; attestation github-actions-provenance https://github.com/ScopeBlind/verified-runs/actions/runs/34678858933
Standard: pr:7a1e5b9c3d2f4e60, digest 916cad30b3c2db2a, gate policy sha256:b88a9487c62d
Receipts: 22 signed by sb:issuer:GsAFpSRUAvaU, chain head sha256:a3da3f290958; calls log sha256:252ac1d8ece8 (published)
hello-world attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 10 s; workspace 1 file sha256:213ef636d20e (published)
countdown-game attempt 1: fail (0 passed, 2 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 85 s; workspace 0 files sha256:602e35a92eec (published)
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 8.4.1, run by the harness); 16 calls, 0 refused; 146 s; workspace 1 file sha256:bb533ad59607 (published)
assign-seats attempt 1: fail (0 passed, 2 failed, pytest 8.4.1, run by the harness); 4 calls, 0 refused; 79 s; workspace 0 files sha256:602e35a92eec (published)
Result: 2 of 4 passed; 22 governed calls, 0 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: pin them through a channel you already trust.
- That the run was made in the workflow it names: the attestation is referenced (https://github.com/ScopeBlind/verified-runs/actions/runs/34678858933) but its bundle was not supplied. Supply provenance/*.sigstore.jsonl to verify it here, or run gh attestation verify.
- That the verdicts are more than the harness's word: no second grading is supplied. The archived workspace and the pinned tests let anyone make one.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline, inside this folder: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl --calls calls.jsonl --regrade regrade.json --provenance provenance --model-calls model-calls.jsonl --model-attestation model-attestation.json` (from @veritasacta/verify 0.10.11 the exit status is 0 only when the run binds to everything given; add `--maintainer-key maintainer-key.json` from the repository root to pin the maintainer key), or drop the files together on legate.scopeblind.com/verify.

Removing a receipt from the front leaves a dangling link, which the verifier reports; removing one from the end changes the head and the count the manifest pins; a chain re-signed from scratch needs the keys, which is why the standard names them and why demonstration keys prove the mechanism only. A receipt records the call the gate saw, not what the call did: open calls.jsonl for that, and the workspace archive for what was left behind. The verdicts are the harness's own test run until a second grading reconciles them.
