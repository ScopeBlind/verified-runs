# A verified run

One agent (legate-attested-loop legate-attested-loop 1.0, model Qwen/Qwen3.8-27B) ran 4 tasks from terminal-bench/original-tasks at d28711d0, every tool call through protect-mcp 0.13.3 under the policy compiled from the signed standard. Produced by verified-run.mjs on 2026-09-12; verified as committed by check-verified-run.mjs on every build. The standard is signed by the maintainer key published at the repository root (maintainer-key.json), the second grading by the published grader key (grader-key.json), and the gateway and harness keys were generated inside this run and discarded with it: real signatures, published identities.

| File | What it is |
|---|---|
| standard.json | The maintainer's signed standard: allowed tools, no network, one attempt, the time limit, the task-set and harness pins, and the Cedar the gate enforced. |
| policy/standard.cedar | The policy, compiled from the standard; its digest is in the standard and in every receipt. |
| receipts.jsonl | The gateway's receipt chain: one signed receipt per attempted tool call, allowed or refused, each linked to the previous. |
| manifest.json | The harness's signed account: pins, every attempt with its receipts and test verdict, the chain head. |
| task-set.json | The pinned task set: file paths and hashes at the benchmark commit, never the files. Reference solutions were never fetched. Dockerfile RUN lines, if any, are listed as not applied. |
| harness.json | The harness pin: the digest of the harness file and the run core it runs on, as the standard names it. |
| model-calls.jsonl | Signed by the model's TEE, kept by the harness: one record per model call: the digests of the exact request and response bytes, the TEE's signature over them, and the signing address. The manifest pins the log by digest and each attempt names its range. |
| model-attestation.json | From the inference provider: the attestation report for each signing address: an Intel TDX quote whose report_data binds the signing key, verified offline against Intel's root; the manifest pins each report by digest. |
| model-calls-bodies.jsonl | The request and response bytes behind each record, published or held (held bodies stay with the maintainer; the digests bind them either way). |
| provenance/ | When the run was made in GitHub Actions: Sigstore bundles for manifest.json, receipts.jsonl, standard.json, and regrade.json: the workflow, repository, commit, and run that produced these bytes, verified offline against the pinned Sigstore trust root by the verifier, or independently with gh attestation verify. |
| oracle.json | The real engine's verdict on every counterexample the compiler emitted. |
| tests/ | The harness's own pytest output per task; its digest is in the manifest. |
| calls.jsonl | The call behind every receipt, in order: tool and input, bound by the input digest each receipt carries. Open it to see what each shell call did. |
| workspace/ | What the agent left in each task directory, pinned by digest in the manifest, so anyone can re-run the pinned tests on it. |
| regrade.json | A second grading, when made: the pinned tests re-run on the archived workspace, signed under a distinct grader key the standard accepts. `regrade.mjs` makes one. |
| regrades/<grader>/ | Gradings made elsewhere, when adopted: each with the provenance bundle that names its bytes, accepted by the identity the standard names. Here: veritasacta-verified-runs-grader. |

## Result

```
Run run:ac952151a1c59a40, signed by Legate verified-run harness (ephemeral, held by the workflow run) (harness:194dac3cde1363e7) at 2026-09-12T08:02:02.115Z
Task set: terminal-bench/original-tasks at d28711d0da2675d0bb1d56de45ae5df6082438a3, 4 tasks, digest sha256:86e96c233772
Agent: legate-attested-loop legate-attested-loop 1.0, model Qwen/Qwen3.8-27B via cloud-api.near.ai (attested TDX inference); attested: 22 model calls signed inside near-ai-cloud's TEE for Qwen/Qwen3.8-27B, 1 report
Harness: legate-verified-run (sha256:a35496d6f317), gateway protect-mcp 0.13.3
Environment: Linux bubblewrap for tool commands (network disabled); the harness makes the model calls over TLS to the attested provider; egress to cloud-api.near.ai; attestation github-actions-provenance https://github.com/ScopeBlind/verified-runs/actions/runs/34682012429
Standard: pr:7a1e5b9c3d2f4e60, digest 905060cd153673fa, gate policy sha256:b88a9487c62d
Receipts: 23 signed by sb:issuer:CuhL1CedXFHf, chain head sha256:40e725602e91; calls log sha256:be6c85b08d9a (published)
hello-world attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 10 s; workspace 1 file sha256:7b6a3d9729f9 (published)
countdown-game attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 1 call, 0 refused; 15 s; workspace 1 file sha256:ac41bacc6a4b (published)
bank-trans-filter attempt 1: pass (1 passed, 0 failed, pytest 8.4.1, run by the harness); 10 calls, 0 refused; 88 s; workspace 1 file sha256:c212c6a3e03c (published)
assign-seats attempt 1: pass (2 passed, 0 failed, pytest 8.4.1, run by the harness); 11 calls, 0 refused; 151 s; workspace 1 file sha256:e2cacc100990 (published)
Result: 4 of 4 passed; 23 governed calls, 0 refused
```

## What this does not establish

- Who holds the harness key or the gateway key: they are not the demonstration keys; pin them through a channel you already trust, or supply the run's provenance.
- Who holds the maintainer key that signed the standard (ScopeBlind, recipient:e1b6a9c5f64f7310): pin its verification key through a channel you already trust.
- That the run was made in the workflow it names: the attestation is referenced (https://github.com/ScopeBlind/verified-runs/actions/runs/34682012429) but its bundle was not supplied. Supply provenance/*.sigstore.jsonl to verify it here, or run gh attestation verify.
- That the verdicts are more than the harness's word: no second grading is supplied. The archived workspace and the pinned tests let anyone make one.
- What the agent said or reasoned: the receipts record tool calls and the harness records test verdicts, not the transcript.

Verify offline, inside this folder: `npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl --calls calls.jsonl --regrade regrade.json --regrade regrades/veritasacta-verified-runs-grader/regrade.json --provenance provenance --provenance regrades/veritasacta-verified-runs-grader --model-calls model-calls.jsonl --model-attestation model-attestation.json`, or drop the files together on legate.scopeblind.com/verify.

Removing a receipt from the front leaves a dangling link, which the verifier reports; removing one from the end changes the head and the count the manifest pins; a chain re-signed from scratch needs the keys, which is why the standard names them and why demonstration keys prove the mechanism only. A receipt records the call the gate saw, not what the call did: open calls.jsonl for that, and the workspace archive for what was left behind. The verdicts are the harness's own test run until a second grading reconciles them.
