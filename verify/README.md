# The run core

`legate-run.core.mjs` is built from the Legate site's own source (`packages/scopeblind-pm/web/src/legate-run-core.ts`, bundled by esbuild with @noble inlined) and vendored here unchanged. It compiles a standard to the gate policy, signs a standard with a recipient key, signs and verifies a run manifest, and verifies receipt chains. It carries the demonstration keys by design.

Every run's `harness.json` records the digest of `harness/verified-run.mjs` and this file together, and the run's standard pins that digest, so verifying a run means verifying exactly these bytes.

sha256 of the current bundle: `c1aabc090fd040349fee1e6c6b631045f1bd1bb147f68c5a2281cb448ca7713d`
