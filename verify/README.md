# The run core

`legate-run.core.mjs` is built from the Legate site's own source (`packages/scopeblind-pm/web/src/legate-run-core.ts`, bundled by esbuild with @noble inlined) and vendored here unchanged. It compiles a standard to the gate policy, signs a standard with a recipient key, signs and verifies a run manifest, and verifies receipt chains. It carries the demonstration keys by design.

Every run's `harness.json` records the digest of `harness/verified-run.mjs` and this file together, and the run's standard pins that digest, so verifying a run means verifying exactly these bytes.

sha256 of the current bundle: `bbc032aae743699a018558ada8d35e55ec93f0c96ae43fc0e55b65f91d93b345`
