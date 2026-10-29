# bound-git-induction (legacy)

Abandoned induction gate: a signed, on-chain, smart-account-authorized
admission path for every git operation (an "induction" that had to be
constructed, signed by both the customer's and the provider's enterprise
accounts, and settled on `UNION_EVM_HOLONOMY_LEDGER` before any git syscall
ran). It was superseded by `bin/git`, the plain shell wrapper that now does
the section's actual job — serializing writes through one lock, refusing
ambient staging and unscoped commits, running as one of `read_commands` or
`write_commands` from a per-machine `etc/machine.conf`.

Preserved here as a record, not as something to run or build against. It is
not wired into `package.json`'s `check`/`test`/`verify` scripts.

## What moved here

- `src/bound-git-induction-*.js`, `src/serve-bound-git-induction.js` — the
  induction service's wire/auth/store/client/production/a2a-executor/
  card-evidence modules and its server entry point.
- `test/bound-git-induction-auth.test.js`,
  `test/bound-git-induction-ingress.test.js`,
  `test/bound-git-induction-service.test.js`,
  `test/bound-git-induction-store.test.js`,
  `test/bound-git-induction-wire.test.js`,
  `test/bound-git-card-evidence-negative.test.js`,
  `test/bound-git-network-sit.test.js`,
  `test/bound-git-live-eip1271.test.js` — its test suite.
- `test/fixtures/bound-git-network-receiver.mjs` — a fixture the test suite
  used.
- `content/contracts/bound-git-induction-tree-v1.rml`,
  `content/contracts/git-operation-via-device-io-admission.rml` — the RML
  contracts the induction gate validated requests against.

One test that exercised this family, `test/bound-git-induction-release.test.js`,
was **not** moved here: two of its three assertions exercise the live
`bin/git` wrapper directly (a hermetic read, a real serialized local
mutation) rather than the induction gate, so it stayed in `test/` and was
renamed to `test/managed-git-policy.test.js`, with its one stale assertion
(expecting the old induction-era denial string `"mutation not admitted"`)
updated to match `bin/git`'s real denial text.
