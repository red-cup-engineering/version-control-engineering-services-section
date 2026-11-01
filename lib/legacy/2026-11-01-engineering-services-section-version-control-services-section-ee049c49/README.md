# Version Control Services Section

This section owns two independently hireable dies implementing this
settlement's Git version-control capability: a device-scoped Git ingress and
the separately hireable device I/O provider it holds no direct authority
over.

`git-services-section` is a Git service using ActivityStreams, typed RMN task
effects, and its own bound-operation contract; it validates Git requests and
supplies only an attenuated, customer-signed operation to its device
coordinator. It never obtains ambient Git or filesystem authority itself.

`block-device-io-coordinator` is the device I/O provider that actually
performs the syscall-scale effect against block device 8:48 (`/dev/sdd`).
Its own `package.json` describes it as a generic device-I/O provider —
today's implementation is 100% Git-shaped, but the die is named for the
device it owns, not the one protocol it currently carries.

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
