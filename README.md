# Verified runs

A benchmark score is a claim by whoever ran it. A verified run is the same score with the evidence attached: files anyone can check offline, with no account and no trust in us.

**The latest run**, [`runs/attested-qwen-qwen3.8-27b-ci-attested-ac952151a1c59a40`](runs/attested-qwen-qwen3.8-27b-ci-attested-ac952151a1c59a40): Qwen 3.8 27B on four public Terminal-Bench tasks, 4 of 4 passed. Every tool call went through the gateway under a signed standard and left a receipt. The model answered inside a confidential machine that signed every call, and that machine's attestation verifies against Intel's root. The result was graded three times: by the harness, by a separate job, and by [VeritasActa/verified-runs-grader](https://github.com/VeritasActa/verified-runs-grader), another organization's workflow. GitHub attests which code produced each file. [See it checked in a browser](https://legate.scopeblind.com/verify?sample=run), or check it yourself:

```bash
cd runs/attested-qwen-qwen3.8-27b-ci-attested-ac952151a1c59a40
npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl --calls calls.jsonl \
  --regrade regrade.json --regrade regrades/veritasacta-verified-runs-grader/regrade.json \
  --provenance provenance --provenance regrades/veritasacta-verified-runs-grader \
  --model-calls model-calls.jsonl --model-attestation model-attestation.json
```

The verifier prints what the files establish and what they do not, check by check. `gh attestation verify manifest.json --owner scopeblind` is an independent path to the provenance. Drop the same files together on [legate.scopeblind.com/verify](https://legate.scopeblind.com/verify) for the same answer in a browser.

## What a stranger can check

| Question | Answered by | How it is checked |
|---|---|---|
| What was the agent allowed to do? | `standard.json`, signed by the maintainer | The tool list, the network rule, the attempts and time limit, the pinned task set and harness, and the Cedar policy compiled from them. |
| What did it actually do? | `receipts.jsonl`, signed by the gateway; `calls.jsonl` | One receipt per tool call, allowed or refused, hash-chained, each citing the policy digest and the digest of the call's input; the calls log opens each one to the command it was. |
| Did it pass? | `manifest.json`, signed by the harness; `regrade.json`; `regrades/<grader>/` | The harness ran each task's own tests, not the agent's word. A second grading re-ran the pinned tests on the archived workspace in a separate job; a third came from another organization's workflow, accepted by the provenance that names it. The verifier requires every grading supplied to agree. |
| Which model answered? | `model-calls.jsonl`, `model-attestation.json` | Every call signed inside the provider's confidential machine; the Intel TDX quote that binds the signing key verified offline against the pinned Intel root. |
| Was it made the way it says? | `provenance/*.sigstore.jsonl` | GitHub's build provenance for each file, verified offline against the pinned Sigstore trust root: workflow, repository, commit, run, and transparency-log entry. |
| Whose keys? | `maintainer-key.json`, `grader-key.json` | Published here and on [legate.scopeblind.com/trust](https://legate.scopeblind.com/trust). Gateway and harness keys are generated inside each workflow run and discarded with it; the provenance binds them. |

## The runs

| Run | Agent, model | Passed | Graded by | Keys | Made in |
|---|---|---|---|---|---|
| [codex-gpt-5.5-ci-acdc37bdee606700](runs/codex-gpt-5.5-ci-attested-acdc37bdee606700) | codex-cli, gpt-5.5 | 3 of 4 | the harness, a separate job | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34664927913) |
| [codex-gpt-5.5-ci-84da2e701aa10825](runs/codex-gpt-5.5-ci-attested-84da2e701aa10825) | codex-cli, gpt-5.5 | 4 of 4 | the harness, a separate job | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34667881546) |
| [codex-gpt-5.5-ci-3ba539cf9863f7b8](runs/codex-gpt-5.5-ci-attested-3ba539cf9863f7b8) | codex-cli, gpt-5.5 | 4 of 4 | the harness | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34597720550) |
| [codex-gpt-5.5-ci-0597c4d7e583cab6](runs/codex-gpt-5.5-ci-attested-0597c4d7e583cab6) | codex-cli, gpt-5.5 | 4 of 4 | the harness, a separate job | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34669544351) |
| [codex-gpt-5.5-1c3d2cc199a86f2a](runs/codex-gpt-5.5-1c3d2cc199a86f2a) | codex-cli, gpt-5.5 | 4 of 4 | the harness | demonstration | a laptop |
| [claude-code-sonnet-5-eade3f9c533d9be4](runs/claude-code-sonnet-5-eade3f9c533d9be4) | claude-code, claude-sonnet-5 | 4 of 4 | the harness | demonstration | a laptop |
| [claude-code-sonnet-5-ci-bab08b93c9611d20…](runs/claude-code-sonnet-5-ci-attested-bab08b93c9611d20) | claude-code, claude-sonnet-5 | 4 of 4 | the harness | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34606014128) |
| [claude-code-sonnet-5-ci-6e8535914100e45c…](runs/claude-code-sonnet-5-ci-attested-6e8535914100e45c) | claude-code, claude-sonnet-5 | 4 of 4 | the harness, a separate job | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34664929869) |
| [attested-qwen-qwen3.8-27b-ci-ac952151a1c59a4…](runs/attested-qwen-qwen3.8-27b-ci-attested-ac952151a1c59a40) | attested-loop, Qwen/Qwen3.8-27B (attested) | 4 of 4 | the harness, a separate job, VeritasActa | published | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34682012429) |
| [attested-qwen-qwen3.8-27b-ci-00856fa42e6ae29…](runs/attested-qwen-qwen3.8-27b-ci-attested-00856fa42e6ae290) | attested-loop, Qwen/Qwen3.8-27B (attested) | 2 of 4 | the harness, a separate job | demonstration | [CI](https://github.com/ScopeBlind/verified-runs/actions/runs/34678858933) |

Every tool call in every run went through [protect-mcp](https://github.com/scopeblind/scopeblind-gateway) under a policy compiled from the maintainer's signed standard, and the harness, not the agent, ran each task's own tests. Each run folder has a README listing its files and what they do not establish.

## Making one

Dispatch the workflow (`verified-run.yml`: agent `codex`, `claude`, or `attested`; a task list or a sealed set; the model), or run the harness on a machine of your own:

```bash
node harness/verified-run.mjs --agent attested --model Qwen/Qwen3.8-27B --tasks hello-world,countdown-game --out runs/my-run
node harness/regrade.mjs --run runs/my-run --sign
```

A run made on a laptop says so in its manifest and carries no provenance; a run made by the workflow carries the attestation bundles beside it. To grade someone else's run from outside their repository, fork [the grader](https://github.com/VeritasActa/verified-runs-grader).

## The files, in detail

| File | Who signs it | What it says |
|---|---|---|
| `standard.json` | The maintainer | Which tools the agent may call, what network the environment may reach, how many attempts and how long per task, the task set and the harness pinned by digest, the one model route, and the Cedar policy compiled from those requirements. |
| `receipts.jsonl` | The gateway | One signed receipt per attempted tool call, allowed or refused, each linked to the previous by hash, each citing the policy digest, each carrying the digest of the call's input. |
| `manifest.json` | The harness | The pins, every attempt with the receipts it produced and the harness's own test verdict, the chain head, the agent and model, the environment, the digest of the calls log and of what the agent left in each task directory, and the provenance attestation when there is one. |

Beside them, when the maintainer publishes them: `calls.jsonl`, the call behind every receipt (tool and input), bound by the input digest each receipt carries; `workspace/`, what the agent left in each task directory, pinned by digest; `tests/`, the harness's own test output, digested by the manifest; `regrade.json`, a second grading of the run made by re-running the pinned tests on the archived workspace, signed under a distinct grader key the standard accepts; and `regrades/<grader>/`, gradings made elsewhere, each with the provenance bundle naming its exact bytes. On a sealed task set the calls and the workspaces are held by the maintainer, and their digests in the manifest still bind them.

The verifier reports `bound` when the manifest names that standard by digest, the receipts are the ones the manifest names (count and chain head), every receipt cites the policy compiled from the standard, every allowed call names a tool on the standard's list, no task exceeded the allowed attempts or time, the task-set and harness pins match, and the gateway and harness keys are ones the standard accepts. For a run made by the workflow, the provenance bundles under `provenance/` are consumed by the verifier (`harness/check-verified-run.mjs`, and `@veritasacta/verify --provenance`): each is checked offline against the pinned Sigstore trust root and tied to the exact bytes of the files given.

### Keys

Runs made by the workflow use no demonstration keys. The maintainer key that signs each run's standard and the grader key that signs each second grading are persistent, held as repository secrets (`LEGATE_MAINTAINER_SEED`, `LEGATE_GRADER_SEED`) that never leave the workflow, and their verification keys are published here: [`maintainer-key.json`](maintainer-key.json) and [`grader-key.json`](grader-key.json). Pin them through a channel you trust: this repository, or the trust page. The gateway key and the harness key are generated inside each workflow run and discarded with it; the provenance binds the manifest that names them. A grading made elsewhere is accepted by the identity in its provenance bundle (`trust.accepted_grader_provenance`), not by a key listed in advance.

### An attested model route

A run made with `--agent attested` names its model with evidence instead of a declaration. The agent is a minimal loop on an inference provider that runs the model in a confidential virtual machine and signs, inside it, the digest of every request and response (NEAR AI Cloud's shape). The run carries `model-calls.jsonl` (one signed record per call), `model-attestation.json` (the provider's report for each signing key, with the Intel TDX quote), and `model-calls-bodies.jsonl` (the bytes, published or held). The verifier recovers each call's signer, checks that a verified report binds it, and checks that the attested model is the one the standard names. Not verified here: the platform's current TCB status and the GPU verdict, which need the vendors' current collateral.

## What the chain establishes, exactly

Removing a receipt from the front leaves the next one pointing at a predecessor that is not there; the verifier reports the link as dangling. Removing receipts from the end changes the last receipt's hash and the count, both of which the manifest pins; head alone would not be enough, head and count together are. A chain re-signed from scratch needs the keys, which is why the standard names the gateway, harness, and grader keys it accepts, and why demonstration keys prove the mechanism only. Every receipt records the call the gate saw and the digest of its input, not what the call did; `calls.jsonl` opens the digests, and a reader, not the gate, judges what a shell command reached. The receipts are the calls the host routed through the hook; what the agent could reach without the hook is bounded by the sandbox, which the run declares and, in CI, provenance attests.

## What a run does not establish

- Who holds the keys. Runs made by the workflow since 12 September 2026 carry a standard signed by the published maintainer key and a second grading by the published grader key (`maintainer-key.json`, `grader-key.json`, also on [legate.scopeblind.com/trust](https://legate.scopeblind.com/trust)); their gateway and harness keys were generated inside the workflow run and discarded with it, and the provenance binds them. Earlier runs use demonstration keys whose seeds are in the open source, and say so; they prove the mechanism, not identity.
- That the sandbox enforced the network rule. The gateway sees tool calls, not packets. A run made by the workflow carries a provenance attestation that the verifier checks against the pinned Sigstore trust root, so the workflow, the commit, and the run that produced these bytes are established, and what that workflow configured is in the repository at that commit; a run made on a laptop says so and carries none.
- Anything the agent said or reasoned. The receipts record calls, the harness records verdicts, and the transcript stays with the submitter.
- That the model was never trained on the tasks. A verified run proves process integrity, not the absence of contamination. Sealed task sets (below) are how a maintainer keeps a held-out set held out while still letting anyone verify a run against it.
- That the verdicts are more than the harness's word, unless a second grading says so. The harness that runs the tests also signs the manifest. `regrade.json` re-runs the pinned tests on the archived workspace under a different key; the verifier reconciles the two, and anyone can make a third with `harness/regrade.mjs`.

## What the checks found about themselves

Findings by readers, credited, that changed what the files say or do:

- **arian-gogani (nobulex)**: the standard named self-reported passes as grounds for rejection, did not enforce it, and the run it accepted was one, since the harness graded and the same harness key signed the manifest. Now: workspaces are pinned and archived, `regrade.mjs` re-runs the pinned tests under a distinct grader key, and the verifier holds a run whose standard asks for independent reconciliation until a second grading agrees.
- **arian-gogani (nobulex)**: an allowed `Bash` receipt carrying only the input digest cannot distinguish a directory listing from an egress. Now: the calls log is published beside the receipts (or held, with its digest in the manifest), each call bound to its receipt by that digest, and the report opens it. Also from the same review: "any tool call not on the allowed list" read as rejecting the run whose refusal was the mechanism working; the criterion now says "that the gate allowed".

## Sealed task sets

A task set can be an encrypted archive whose plaintext file paths and hashes are public. The maintainer keeps the key. The harness opens the archive, checks every file against the public pin before anything runs, and never writes the plaintext outside the workspace. A verifier checks the digest only.

```bash
SEALED_TASKS_KEY=<64 hex> node harness/seal-tasks.mjs --tasks a,b --revision <commit> --out task-sets/my-set
```

The sealed set in this repository holds four public Terminal-Bench tasks. It demonstrates the mechanism and nothing more.

## Re-grade a run

```bash
node harness/regrade.mjs --run runs/<run> --sealed task-sets/terminal-bench-4.sealed.json --sign
```

Rebuilds each task directory from the archive the manifest pins, obtains the pinned tests (from the sealed archive with `SEALED_TASKS_KEY`, or from the benchmark repository at the pinned commit) and checks them against the pin, runs pytest, compares every verdict with the manifest's, and with `--sign` writes `regrade.json` under the grader key. The check workflow does this for every committed run whose workspaces are published.

## Make a run

```bash
npm ci
node harness/verified-run.mjs --agent codex --tasks sealed:task-sets/terminal-bench-4.sealed.json --out runs/my-run
node harness/verified-run.mjs --agent claude --tasks hello-world,countdown-game --out runs/my-run
```

The harness pins the task set (every file in each task directory except the reference solution, which is never fetched), pins itself together with the run core it runs on, builds and signs the standard, compiles the policy, runs the agent in a workspace with a PreToolUse hook that receipts every call before deciding, grades with the task's own tests, and signs the manifest. A run in which an attempt produced no receipted call is refused. The agent's own sandbox stands in for the benchmark's Docker image; task paths are rebased from `/app` to the workspace and the tests are run with the same rebase; Dockerfile `RUN` lines are listed as not applied.

`harness/check-verified-run.mjs` checks every committed run the way a reader would, including the calls log against the receipts, the archives against the pins, and the second grading against the manifest; `harness/check-verified-run-adversarial.mjs` applies every mutation we can name to a run and asserts the verifier catches each one. Both run in CI on every push. Runs made in CI are graded twice, in separate jobs, under two keys.

## Where the code comes from

Every run pins the harness and the run core that made it. When those change, the bytes a run pins stay in the repository under `harness/harness-versions/<pin>/`, so a reader can always open exactly what ran; the check refuses a run whose pinned harness is neither current nor archived.

`verify/legate-run.core.mjs` is built from the Legate site's own source and vendored here with its digest; `harness.json` in every run records the digest of the harness file and the core together, and the standard pins it. The verifier is [`@veritasacta/verify`](https://www.npmjs.com/package/@veritasacta/verify), Apache-2.0. The gateway is protect-mcp, MIT.

## License

MIT.
