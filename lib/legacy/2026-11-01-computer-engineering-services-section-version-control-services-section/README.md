# Version Control Services Section

This section owns this settlement's Git version-control capability.

## git-services-section

The live piece, and the thing that actually runs, is `bin/git`: a plain
`/bin/sh` script that stands in for `git` on this shared machine. It reads
per-machine policy from `etc/machine.conf` (repo root, home dir, lock
paths, and the `read_commands`/`write_commands` lists) and per-machine
identity/credentials from `etc/managed.gitconfig`. It refuses to run
outside the configured `repo_root`, refuses repository-override flags
(`-C`, `--git-dir`, etc. — cd into the repo instead), refuses ambient
`git add -A`/`.`/`*` and unscoped `git commit` (both sweep in a concurrent
agent's in-flight changes), and serializes every write command through one
`flock` lane so concurrent agents on one tree cannot corrupt the index or
run the disk out of headroom. Reads pass straight through with
`--no-optional-locks`.

Two more small, live pieces sit next to it:

- `src/settle-filesystem-receipt.mjs` — given a one-line JSON "filesystem
  write receipt" naming a path and its expected post-write SHA-256, proves
  the file on disk still matches that hash, then stages and commits exactly
  that one path through `bin/git`. It refuses if anything is already staged
  — a pre-staged index looks the same as the ambient dirt this exists to
  rule out.
- `src/collect-colony-activity.mjs` — reads this repository's
  `GitOperationWitness` records out of `data/rmn` and rolls them into a
  `ColonyActivityPulseEnvelope` (counts of solicitations, offers,
  completions, refusals in a time window). It has no CLI of its own; other
  packages (e.g. `board-of-directors/.../leader-movement-team`,
  `bare-cedar-fog-colony-administrative-services-sector/.../colony-report-team`)
  import it as one of several per-domain activity providers a colony report
  rolls up.

`lib/legacy/` (in this section root, and again inside
`git-services-section/lib/legacy/bound-git-induction/`) holds parked
reference code and a retired ceremony, not live product — see the `README.md`
in each for exactly what's there and why it isn't wired up.

`git-services-section/services/` holds sibling seats: a `.gitmodules`
parser/encoder (`gitmodules-file-codec-service`), a recursive
commit-and-push-through-submodules helper (`git-recursive-commit-service`),
and a `git-forge-services-section` subtree for Git-forge capabilities.
GitHub's repository, Models, and Actions integrations are web-platform
services at
`web-services-section/services/web-platform-services-section/services/web2-platform-services-section/services/web2-software-platform-services-section/services/github-services-section/`.

## block-device-io-coordinator

`block-device-io-coordinator` is a separately hireable device I/O
provider, built to eventually own the actual syscall-scale effect against
a specific block device (`8:48` / `/dev/sdd`) rather than trust ambient
filesystem access. It is well-built and well-tested (11 of its 12 tests
pass as of this writing; the one failure is a stale expected-hash
assertion in `test/bound-git-profile-wire.test.js`, unrelated to this
cleanup). It has never been wired to a real caller, and its own
`content/host-activation.md` says plainly that the host-side cgroup
delegation it would need to actually enforce device-level isolation has
never been set up on any machine — "the executable service advertises
only cooperative Git serialization" until that operator step happens.
Today, nothing in this section calls it.

## Provenance

Both dies were relocated here from
`board-of-directors/services/executive-office/services/change-services-section/`,
on Leader authorization, on 2026-07-25. Git version-control tooling's
owning boundary faculty is software engineering, not change-management
administration: a shared public-protocol implementation is a separately
hireable provider under the boundary faculty that owns its protocol, and
that faculty is this section's, not Executive Office's. The existing
`repository-state-observation-service` (already seated under
`software-development-services-section`) already consumed
`git-services-section` purely over the `GIT_ANT_*` environment-variable wire
protocol from a separate repository before this move; that consumption
pattern is unchanged by the relocation — it was already cross-repo, and it
stays cross-repo, just to a new address.

`drive-sdd-io-coordinator-ant-colony` was renamed to
`block-device-io-coordinator` in the move, dropping the historical
"ant-colony" naming convention it no longer needed once decoupled from
Executive Office's colony vocabulary. `git-services-section` kept its name
unchanged — it was already a clear name.

Left untouched by the move, by design (mirroring the `git-ant-colony` ->
`git-services-section` rename precedent this relocation follows): the
`GIT_ANT_*` environment-variable wire protocol (a separate, actively
multi-consumer wire interface), and each die's
`content/evm/accounts/eip155-31337.json` `nodeId`/`urn` (an already-deployed
on-chain account binding that needs a proper account recut, not a label
edit, to follow either move).

`git-services-section`'s own `bound-git-induction` family — a signed,
on-chain, smart-account-gated admission ceremony that used to sit in front
of every Git operation, with its own ActivityStreams/RMN-task/bound-operation
contract vocabulary — was retired on 2026-07-31 and moved to
`git-services-section/lib/legacy/bound-git-induction/`. It never became
the thing `bin/git` above actually is; it is preserved there only as a
record of what was tried.
