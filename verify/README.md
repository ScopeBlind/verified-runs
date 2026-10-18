# The run core

`legate-run.core.mjs` is built from the ScopeBlind site's own source (`packages/scopeblind-pm/web/src/legate-run-core.ts`, bundled by esbuild with @noble inlined) and vendored here. It compiles a standard to the gate policy, signs a standard with a recipient key, signs and verifies a run manifest, and verifies receipt chains. It carries the demonstration keys by design.

Two sections are patched in this repository and are not yet in the site's source: `src/authority.ts` and `src/receiver-runtime.ts`, the grants, allocations and receivers the swarm runs use. The patch closes the authority holes found in review on 17 October 2026 (see the README and `harness/check-authority.mjs`):

- a receiver registers a grant only if a principal it pins signed it and the grant names this receiver; every allocation carved from it must be made out to the same receiver;
- the receiver keeps every node of every tree it registers and refuses a registration or a spend that would carve or spend more than a node holds;
- allocations are named by digest, so taking another allocation's id captures nothing;
- a spend id names one operation across the whole receiver, and only live and committed operations are unique, so a released one can be retried;
- the quota counts a whole subtree (and, with `grant_max`, a whole grant);
- every decision cites a journal entry of its own, `register()` gives the real reason for a refusal, and `restore()` given the pins verifies every registration again.

Everything else in the file is the build, unchanged. The patch must be carried into the site's source before the bundle is next rebuilt from it, or the rebuild undoes it.

Every run's `harness.json` records the digest of the harness files and this file together, and the run's standard pins that digest, so verifying a run means verifying exactly these bytes. Runs made before the patch pin the earlier bytes, kept under `harness/harness-versions/`.

sha256 of the current bundle: `1693f9b4ee3e0be3e70369c4e6b7822444212a068f249ad744e491ad93704134`
