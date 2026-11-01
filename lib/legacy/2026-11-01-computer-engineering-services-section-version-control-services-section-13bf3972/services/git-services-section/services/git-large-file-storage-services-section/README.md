# Git large file storage

How this repository's large files are stored, and where they actually go.

## `report-git-lfs-state`

Prints the resolved endpoint, the configured transfer agents, and the size of
the object store on this machine. `--json` emits the same facts as a record.

The service exists because these are two different quantities that read alike:

- **objects on this machine** — regular files under `.git/lfs/objects`
- **objects a server holds** — what a push actually delivered

A local count was once reported as an upload result four times running, while
the true uploads were 69 bytes and 0 bytes. The return shape keeps the two
apart, and a test asserts that the local figure always carries the qualifier
that it says nothing about any server.

## How this repository is configured

Measured 2026-08-17, not recalled:

| Setting | Value |
| --- | --- |
| origin | `git@github.com:emsenn/bare-cedar-fog.git` |
| LFS endpoint | `https://github.com/emsenn/bare-cedar-fog.git/info/lfs` |
| endpoint source | the origin remote — `lfs.url` is unset |
| `lfs.standalonetransferagent` | unset |
| registered custom agent | `r2-bare-cedar-fog` (registered, not selected) |
| objects on this machine | 799, 1.0 GB |

`.gitattributes` declares 68 patterns to LFS, covering media, archives,
documents, and the append-only and object-store patterns added when captured
repositories arrived.

## Why it is this way

The R2 custom transfer agent lives in
`bare-cedar-fog-r2-git-lfs-services-section`, under the Cloudflare section of
the machine that owns the bucket. It works: a 200,000-byte object round-trips
byte-identically. It is registered here but not selected.

It was selected, once, and that broke every push. A custom agent named in
`lfs.standalonetransferagent` replaces the server's transfer negotiation
entirely, so objects went to R2 and GitHub's LFS store received nothing. GitHub
then refused each push with GH008, because its pre-receive hook rejects pointers
naming objects it does not hold. Unsetting the agent and pushing to GitHub's own
LFS store cleared it, and 791 MB transferred.

So the present arrangement is deliberate but temporary: it is the configuration
that pushes, not the configuration that should hold a binary corpus. GitHub's
LFS store is quota-bound and the object store is already at 1.0 GB.

## What still has to be decided

Objects reach R2 through a transfer agent that GitHub cannot see. For R2 to hold
them without breaking pushes, either

- an LFS server sits in front of R2 and `lfs.url` points at it, so git-lfs
  negotiates normally and GitHub is never asked to validate the objects, or
- the binary corpus is not pushed to GitHub at all, and the GitHub repository
  carries a pruned subset while this machine keeps the whole.

The second matches the standing instruction to hold everything locally first and
cut a manageable published repository later.

Neither is needed to commit. Committing an LFS-tracked file runs the clean
filter locally, writes the pointer, and stores the object under
`.git/lfs/objects`; a repository with no remote at all does this correctly.
Only pushing needs a server. Nothing about the R2 question blocks bringing the
library into this repository.

## Scope

This node describes and reports. It does not move objects, hold credentials, or
choose storage. Credentials for the R2 bucket are read at invocation from the
environment by the agent that owns them, and never recorded here.
