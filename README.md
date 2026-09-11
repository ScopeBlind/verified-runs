# Verified runs

A benchmark score is a claim by whoever ran it. A verified run is the same score with the evidence attached, in three files anyone can check offline with no account:

| File | Who signs it | What it says |
|---|---|---|
| `standard.json` | The maintainer | Which tools the agent may call, what network the environment may reach, how many attempts and how long per task, the task set and the harness pinned by digest, the one model route, and the Cedar policy compiled from those requirements. |
| `receipts.jsonl` | The gateway | One signed receipt per attempted tool call, allowed or refused, each linked to the previous by hash, each citing the policy digest, each carrying the digest of the call's input. |
| `manifest.json` | The harness | The pins, every attempt with the receipts it produced and the harness's own test verdict, the chain head, the agent and model, the environment, and the provenance attestation when there is one. |

Every tool call the agent made went through [protect-mcp](https://github.com/scopeblind/scopeblind-gateway) under a policy compiled from the maintainer's signed standard, and the harness, not the agent, ran each task's own tests.

## Verify a run

```bash
cd runs/<run>
npx @veritasacta/verify manifest.json --standard standard.json --receipts receipts.jsonl
```

The verifier reports `bound` when the manifest names that standard by digest, the receipts are the ones the manifest names (count and chain head), every receipt cites the policy compiled from the standard, every allowed call names a tool on the standard's list, no task exceeded the allowed attempts or time, the task-set and harness pins match, and the gateway and harness keys are ones the standard accepts. Or drop the manifest on [legate.scopeblind.com/verify](https://legate.scopeblind.com/verify) and add the other two files.

For a run made by the workflow in this repository, GitHub's build provenance covers the three files:

```bash
gh attestation verify runs/<run>/manifest.json --owner scopeblind
```

## What a run does not establish

- Who holds the maintainer, gateway, and harness keys. The runs here use demonstration keys whose seeds are in the open source; they prove the mechanism, not identity. A maintainer supplies real keys by signing the standard and naming the gateway and harness keys it accepts.
- That the sandbox enforced the network rule. The gateway sees tool calls, not packets. A run made by the workflow carries a provenance attestation naming the workflow; a run made on a laptop says so and carries none.
- Anything the agent said or reasoned. The receipts record calls, the harness records verdicts, and the transcript stays with the submitter.
- That the model was never trained on the tasks. A verified run proves process integrity, not the absence of contamination. Sealed task sets (below) are how a maintainer keeps a held-out set held out while still letting anyone verify a run against it.

## Sealed task sets

A task set can be an encrypted archive whose plaintext file paths and hashes are public. The maintainer keeps the key. The harness opens the archive, checks every file against the public pin before anything runs, and never writes the plaintext outside the workspace. A verifier checks the digest only.

```bash
SEALED_TASKS_KEY=<64 hex> node harness/seal-tasks.mjs --tasks a,b --revision <commit> --out task-sets/my-set
```

The sealed set in this repository holds four public Terminal-Bench tasks. It demonstrates the mechanism and nothing more.

## Make a run

```bash
npm ci
node harness/verified-run.mjs --agent codex --tasks sealed:task-sets/terminal-bench-4.sealed.json --out runs/my-run
node harness/verified-run.mjs --agent claude --tasks hello-world,countdown-game --out runs/my-run
```

The harness pins the task set (every file in each task directory except the reference solution, which is never fetched), pins itself together with the run core it runs on, builds and signs the standard, compiles the policy, runs the agent in a workspace with a PreToolUse hook that receipts every call before deciding, grades with the task's own tests, and signs the manifest. A run in which an attempt produced no receipted call is refused. The agent's own sandbox stands in for the benchmark's Docker image; task paths are rebased from `/app` to the workspace and the tests are run with the same rebase; Dockerfile `RUN` lines are listed as not applied.

`harness/check-verified-run.mjs` checks every committed run the way a reader would, and `harness/check-verified-run-adversarial.mjs` applies every mutation we can name to a run and asserts the verifier catches each one. Both run in CI on every push.

## Where the code comes from

Every run pins the harness and the run core that made it. When those change, the bytes a run pins stay in the repository under `harness/harness-versions/<pin>/`, so a reader can always open exactly what ran; the check refuses a run whose pinned harness is neither current nor archived.

`verify/legate-run.core.mjs` is built from the Legate site's own source and vendored here with its digest; `harness.json` in every run records the digest of the harness file and the core together, and the standard pins it. The verifier is [`@veritasacta/verify`](https://www.npmjs.com/package/@veritasacta/verify), Apache-2.0. The gateway is protect-mcp, MIT.

## License

MIT.
