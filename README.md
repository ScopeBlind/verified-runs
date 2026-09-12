# Verified runs

A benchmark score is a claim by whoever ran it. A verified run is the same score with the evidence attached, in three files anyone can check offline with no account:

| File | Who signs it | What it says |
|---|---|---|
| `standard.json` | The maintainer | Which tools the agent may call, what network the environment may reach, how many attempts and how long per task, the task set and the harness pinned by digest, the one model route, and the Cedar policy compiled from those requirements. |
| `receipts.jsonl` | The gateway | One signed receipt per attempted tool call, allowed or refused, each linked to the previous by hash, each citing the policy digest, each carrying the digest of the call's input. |
| `manifest.json` | The harness | The pins, every attempt with the receipts it produced and the harness's own test verdict, the chain head, the agent and model, the environment, the digest of the calls log and of what the agent left in each task directory, and the provenance attestation when there is one. |

Beside them, when the maintainer publishes them: `calls.jsonl`, the call behind every receipt (tool and input), bound by the input digest each receipt carries; `workspace/`, what the agent left in each task directory, pinned by digest; `tests/`, the harness's own test output, digested by the manifest; and `regrade.json`, a second grading of the run made by re-running the pinned tests on the archived workspace, signed under a distinct grader key the standard accepts. On a sealed task set the calls and the workspaces are held by the maintainer, and their digests in the manifest still bind them.

Every tool call the agent made went through [protect-mcp](https://github.com/scopeblind/scopeblind-gateway) under a policy compiled from the maintainer's signed standard, and the harness, not the agent, ran each task's own tests.

## Verify a run

```bash
cd runs/<run>
npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl
```

The verifier reports `bound` when the manifest names that standard by digest, the receipts are the ones the manifest names (count and chain head), every receipt cites the policy compiled from the standard, every allowed call names a tool on the standard's list, no task exceeded the allowed attempts or time, the task-set and harness pins match, and the gateway and harness keys are ones the standard accepts. Or drop the manifest on [legate.scopeblind.com/verify](https://legate.scopeblind.com/verify) and add the other two files.

For a run made by the workflow in this repository, GitHub's build provenance covers the manifest, the receipt chain, the standard, and the second grading, and the bundles are kept beside the run under `provenance/`. The verifier consumes them: `harness/check-verified-run.mjs` (and `@veritasacta/verify --provenance runs/<run>/provenance`, from 0.10.5) checks each bundle offline against the pinned Sigstore public-good trust root: the certificate chain to Fulcio, the workflow identity in the certificate (issuer, workflow, repository, commit, run) against what the manifest names, the DSSE signature, the Rekor entry and its signed timestamp, the inclusion proof and signed checkpoint, and the certificate-transparency SCT; then each file's exact bytes must be a subject of a verified bundle. Where the attested commit is in this repository's history, the check also confirms that the harness pair the manifest pins is the pair the repository held at that commit. GitHub's own verifier remains an independent path:

```bash
gh attestation verify runs/<run>/manifest.json --owner scopeblind
```

## An attested model route

A run made with `--agent attested` names its model with evidence instead of a declaration. The agent is a minimal loop on an inference provider that runs the model in a confidential virtual machine and signs, inside it, the digest of every request and response (NEAR AI Cloud's shape). The run carries `model-calls.jsonl` (one signed record per call), `model-attestation.json` (the provider's report for each signing key: an Intel TDX quote whose report_data binds the key), and `model-calls-bodies.jsonl` (the bytes, published or held). The verifier checks each signature, verifies each quote offline to the Intel SGX Root CA it pins (quote signature, quoting-enclave binding and signature, PCK chain, validity), checks the key binding and the nonce in report_data, and holds every call to the model the standard names. Not established: the platform's current TCB status, the GPU verdict (NVIDIA's online service; its evidence is kept beside the report), and what the model did with the bytes beyond signing them. `harness/check-verified-run.mjs` also proves the primitives on every push against a real sample quote (`harness/fixtures/`, from the dcap-qvl project, MIT) and the provider's documented signature vector.

```bash
NEARAI_CLOUD_API_KEY=... node harness/verified-run.mjs --agent attested --model Qwen/Qwen3.8-27B --tasks hello-world,countdown-game --out runs/my-run
```

## What the chain establishes, exactly

Removing a receipt from the front leaves the next one pointing at a predecessor that is not there; the verifier reports the link as dangling. Removing receipts from the end changes the last receipt's hash and the count, both of which the manifest pins; head alone would not be enough, head and count together are. A chain re-signed from scratch needs the keys, which is why the standard names the gateway, harness, and grader keys it accepts, and why demonstration keys prove the mechanism only. Every receipt records the call the gate saw and the digest of its input, not what the call did; `calls.jsonl` opens the digests, and a reader, not the gate, judges what a shell command reached. The receipts are the calls the host routed through the hook; what the agent could reach without the hook is bounded by the sandbox, which the run declares and, in CI, provenance attests.

## What a run does not establish

- Who holds the maintainer, gateway, and harness keys. The runs here use demonstration keys whose seeds are in the open source; they prove the mechanism, not identity. A maintainer supplies real keys by signing the standard and naming the gateway and harness keys it accepts.
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
